import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInterface } from 'node:readline';
import { BridgeOutputWriter, createIpc, attachStdio, runCli, type OutputSink } from '../cli';
import { unknownCapability } from '../claude/capabilities';
import { BRIDGE_EVENT_TYPES } from '../generated/protocol-contract';
import type { AgentEvent } from '../types';
import { bridgeCommandAckFrame, bridgeHeartbeatFrame, type ProviderCapability } from '../protocol';
import type { AgentRunProfile } from '../agent-profile';
import { SessionManager } from '../session-manager';
import { defaultProviderRegistry, UnknownProviderError } from '../providers/registry';
import type { ProviderContext } from '../providers/types';

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(BRIDGE_EVENT_TYPES);

const SPI_TIMEOUT_MS = 25_000;

interface WireFrame {
	type: string;
	id?: string;
	accepted?: boolean;
	error?: string;
	message?: string;
	ts?: number;
	text?: string;
	code?: string;
	capabilities?: Array<{ state: string }>;
	servers?: Array<{ name: string; status: string; error?: string }>;
}

class ManualBackpressureStream {
	readonly chunks: string[] = [];
	#drainListener: (() => void) | null = null;
	#blockNextWrite = true;

	write(chunk: string): boolean {
		this.chunks.push(chunk);
		if (!this.#blockNextWrite) return true;
		this.#blockNextWrite = false;
		return false;
	}

	once(event: string, listener: () => void): this {
		if (event !== 'drain') throw new Error(`unexpected listener: ${event}`);
		this.#drainListener = listener;
		return this;
	}

	release(): void {
		const listener = this.#drainListener;
		this.#drainListener = null;
		listener?.();
	}

	blockNextWrite(): void {
		this.#blockNextWrite = true;
	}
}

function capabilitySnapshot(state: 'ready' | 'needs_auth'): ProviderCapability {
	return {
		...unknownCapability('not probed'),
		state,
		authenticated: state === 'ready',
		version: '2.1.196',
		account: state === 'ready' ? { email: 'ada@example.com', plan: 'Claude Max' } : null,
		message: state === 'ready' ? 'Signed in as ada@example.com' : 'Sign in to Claude Code to start',
	};
}

function registerTestProvider(): void {
	defaultProviderRegistry.setProvider(async (ctx, emit) => {
		const sessionId = ctx.sessionId;
		return {
			async sendPrompt(prompt: string, runId: string) {
				emit({ type: 'run.started', runId, sessionId });
				emit({ type: 'assistant.message', runId, text: prompt });
				emit({ type: 'run.completed', runId, summary: 'stub: completed' });
			},
			async cancel(runId: string) {
				emit({ type: 'run.failed', runId, error: 'cancelled' });
			},
			async close() {
				emit({ type: 'session.state', sessionId, status: 'completed' });
			},
		};
	});
}

function createOutputSink(): OutputSink {
	return {
		write: () => true,
		once: () => undefined,
	};
}

function parseFrames(stdout: string): WireFrame[] {
	return stdout
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line): WireFrame => JSON.parse(line));
}

function agentFrames(stdout: string): WireFrame[] {
	return parseFrames(stdout).filter((frame) => !frame.type.startsWith('bridge.'));
}

async function spawnCli(
	input: string,
	timeoutMs = SPI_TIMEOUT_MS,
): Promise<{
	stdout: string;
	stderr: string;
	exitCode: number | null;
}> {
	const cliPath = resolve(__dirname, '..', '..', 'dist', 'cli.js');
	const homeWithoutClaude = mkdtempSync(join(tmpdir(), 'malini-bridge-home-'));
	try {
		return await runChild(cliPath, homeWithoutClaude, input, timeoutMs);
	} finally {
		rmSync(homeWithoutClaude, { recursive: true, force: true });
	}
}

function runChild(
	cliPath: string,
	home: string,
	input: string,
	timeoutMs: number,
): Promise<{
	stdout: string;
	stderr: string;
	exitCode: number | null;
}> {
	return new Promise((resolveP, rejectP) => {
		const child = spawn(process.execPath, [cliPath], {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: { PATH: '', HOME: home },
		});
		let stdout = '';
		let stderr = '';
		let settled = false;
		const t = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill('SIGKILL');
			rejectP(
				new Error(`CLI did not exit within ${timeoutMs}ms; stdout=${stdout}; stderr=${stderr}`),
			);
		}, timeoutMs);
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (c: string) => {
			stdout += c;
		});
		child.stderr.on('data', (c: string) => {
			stderr += c;
		});
		child.on('close', (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(t);
			resolveP({ stdout, stderr, exitCode: code });
		});
		child.on('error', (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(t);
			rejectP(err);
		});
		child.stdin.end(input, 'utf8');
	});
}

describe('cli: JSONL over stdio (subprocess)', () => {
	it(
		'registers the Claude Code provider over JSONL and exits cleanly on EOF',
		async () => {
			const input =
				[
					'{"cmd":"start_session","id":"cmd-start","sessionId":"sess-1","workstreamId":"w1","model":"sonnet"}',
					'{"cmd":"close_session","id":"cmd-close","sessionId":"sess-1"}',
				].join('\n') + '\n';

			const { stdout, exitCode } = await spawnCli(input, SPI_TIMEOUT_MS);
			expect(exitCode).toBe(0);

			const frames = parseFrames(stdout);
			const ready = frames.find((frame) => frame.type === 'bridge.ready');
			expect(ready?.capabilities).toEqual([
				expect.objectContaining({ state: expect.stringMatching(/^(ready|needs_auth|missing)$/u) }),
			]);
			expect(frames.filter((frame) => frame.type === 'bridge.command_ack')).toEqual([
				expect.objectContaining({ id: 'cmd-start', accepted: true }),
				expect.objectContaining({ id: 'cmd-close', accepted: true }),
			]);
			const events = agentFrames(stdout);
			for (const event of events) expect(KNOWN_EVENT_TYPES.has(event.type)).toBe(true);
			expect(events).toEqual([expect.objectContaining({ type: 'session.state', status: 'idle' })]);
		},
		SPI_TIMEOUT_MS + 5_000,
	);

	it(
		'rejects malformed JSON with a versioned bridge.protocol_error, exits 0',
		async () => {
			const input = '{not valid\n';
			const { stdout, exitCode } = await spawnCli(input, SPI_TIMEOUT_MS);
			expect(exitCode).toBe(0);
			const error = parseFrames(stdout).find((frame) => frame.type === 'bridge.protocol_error');
			expect(error?.code).toBe('BAD_FRAME');
		},
		SPI_TIMEOUT_MS + 5_000,
	);
});

describe('cli: programmatic IPC (createIpc + attachStdio)', () => {
	it('sanitizes every error-bearing event before it reaches stdout', async () => {
		const stream = new ManualBackpressureStream();
		const writer = new BridgeOutputWriter(stream);
		writer.writeEvent({
			type: 'run.failed',
			runId: 'run-sensitive',
			error:
				'Claude account org-production using <ak-live-secret> hit its usage limit. Response body: {"secret":"sk-private"}',
		});
		writer.writeEvent({
			type: 'tool.failed',
			runId: 'run-sensitive',
			name: 'request',
			error:
				'Request for org-tool failed with Authorization: Bearer opaque-bearer, "Authorization":["Bearer array-bearer"], and sk-tool-secret.\nResponse body: {"debug":"raw-provider-body"}',
		});
		writer.writeEvent({
			type: 'mcp.status',
			runId: 'run-sensitive',
			servers: [
				{ name: 'one', status: 'failed', error: 'MCP ak-mcp-secret for org-mcp failed' },
				{ name: 'two', status: 'failed', error: '{"error":"sk-json-secret"}' },
			],
		});
		writer.writeEvent({
			type: 'run.failed',
			runId: 'run-structured',
			error:
				'{"message":"API call failed","error":{"data":{"message":"Nested provider failure for org-nested"}}}',
		});

		stream.release();
		await writer.drain();
		const stdout = stream.chunks.join('');
		const frames = parseFrames(stdout);

		expect(stdout).not.toMatch(
			/org-production|ak-live-secret|sk-private|org-tool|opaque-bearer|array-bearer|sk-tool-secret|raw-provider-body|ak-mcp-secret|org-mcp|sk-json-secret/u,
		);
		expect(frames[0]?.error).toBe(
			'Claude account [redacted] using [redacted] hit its usage limit.',
		);
		expect(frames[1]?.error).toBe(
			'Request for [redacted] failed with Authorization: Bearer [redacted], "Authorization":["Bearer [redacted]"], and [redacted].',
		);
		expect(frames[2]?.servers).toEqual([
			{ name: 'one', status: 'failed', error: 'MCP [redacted] for [redacted] failed' },
			{ name: 'two', status: 'failed', error: '[redacted]' },
		]);
		expect(frames[3]?.error).toBe('Nested provider failure for [redacted]');
	});

	it('sanitizes command and protocol errors before control frames reach stdout', async () => {
		const stream = new ManualBackpressureStream();
		const writer = new BridgeOutputWriter(stream);
		writer.writeControl({
			type: 'bridge.command_ack',
			protocolVersion: bridgeHeartbeatFrame(0).protocolVersion,
			id: 'sensitive-ack',
			accepted: false,
			error: 'Close failed for org-control with Authorization: Bearer control-token.',
		});
		writer.writeControl({
			type: 'bridge.protocol_error',
			protocolVersion: bridgeHeartbeatFrame(0).protocolVersion,
			code: 'INTERNAL',
			message: 'Protocol failed for <ak-control:opaque> and sk-control-secret.',
		});

		stream.release();
		await writer.drain();
		const stdout = stream.chunks.join('');
		const frames = parseFrames(stdout);

		expect(stdout).not.toMatch(/org-control|control-token|ak-control:opaque|sk-control-secret/u);
		expect(frames[0]?.error).toBe(
			'Close failed for [redacted] with Authorization: Bearer [redacted].',
		);
		expect(frames[1]?.message).toBe('Protocol failed for [redacted] and [redacted].');
	});

	it('respects stdout backpressure while prioritizing ACKs and coalescing heartbeats', async () => {
		const stream = new ManualBackpressureStream();
		const writer = new BridgeOutputWriter(stream);
		writer.writeEvent({
			type: 'assistant.message',
			runId: 'run-first',
			text: 'first event',
		});
		for (let index = 0; index < 100; index += 1) {
			writer.writeEvent({
				type: 'assistant.message',
				runId: `run-${index}`,
				text: `event-${index}`,
			});
		}
		writer.writeControl(bridgeHeartbeatFrame(100));
		writer.writeControl(bridgeHeartbeatFrame(200));
		writer.writeControl(bridgeCommandAckFrame('ack-priority'));

		expect(stream.chunks).toHaveLength(1);
		let drained = false;
		const drain = (async () => {
			await writer.drain();
			drained = true;
		})();
		await Promise.resolve();
		expect(drained).toBe(false);

		stream.release();
		await drain;
		const frames = parseFrames(stream.chunks.join(''));
		expect(frames).toHaveLength(103);
		expect(frames[0]).toMatchObject({ type: 'assistant.message', text: 'first event' });
		expect(frames[1]).toMatchObject({
			type: 'bridge.command_ack',
			id: 'ack-priority',
			accepted: true,
		});
		expect(frames[2]).toMatchObject({ type: 'bridge.heartbeat', ts: 200 });
		expect(frames.filter(({ type }) => type === 'bridge.heartbeat')).toHaveLength(1);
		expect(
			frames
				.filter(({ type }) => type === 'assistant.message')
				.slice(1)
				.map(({ text }) => text),
		).toEqual(Array.from({ length: 100 }, (_, index) => `event-${index}`));
	});

	it('preserves every ACK and event across 32 simultaneous backpressured workstreams', async () => {
		defaultProviderRegistry.setProvider(async (ctx, emit) => ({
			async sendPrompt(prompt, runId) {
				emit({ type: 'run.started', runId, sessionId: ctx.sessionId });
				emit({ type: 'assistant.message', runId, text: prompt });
				emit({ type: 'run.completed', runId, summary: 'done' });
			},
			async cancel() {},
			async close() {},
		}));
		const stream = new ManualBackpressureStream();
		const ipc = createIpc({ stdout: stream });
		const workstreams = Array.from({ length: 32 }, (_, index) => index);

		await Promise.all(
			workstreams.map((index) =>
				ipc.run(
					JSON.stringify({
						cmd: 'start_session',
						id: `start-${index}`,
						sessionId: `session-${index}`,
						workstreamId: `workstream-${index}`,
					}),
				),
			),
		);
		await Promise.all(
			workstreams.map((index) =>
				ipc.run(
					JSON.stringify({
						cmd: 'send_prompt',
						id: `send-${index}`,
						sessionId: `session-${index}`,
						runId: `run-${index}`,
						prompt: `prompt-${index}`,
					}),
				),
			),
		);
		const draining = ipc.drain();
		expect(stream.chunks).toHaveLength(1);
		stream.release();
		await draining;

		const frames = parseFrames(stream.chunks.join(''));
		const acknowledgements = frames.filter(({ type }) => type === 'bridge.command_ack');
		expect(acknowledgements).toHaveLength(64);
		expect(new Set(acknowledgements.map(({ id }) => id))).toEqual(
			new Set(workstreams.flatMap((index) => [`start-${index}`, `send-${index}`])),
		);
		expect(frames.filter(({ type }) => type === 'run.started')).toHaveLength(32);
		expect(frames.filter(({ type }) => type === 'assistant.message')).toHaveLength(32);
		expect(frames.filter(({ type }) => type === 'run.completed')).toHaveLength(32);
		expect(frames.filter(({ type }) => type === 'session.state')).toHaveLength(32);
	});

	it('registers start_session as idle until a prompt starts a run', async () => {
		registerTestProvider();
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const stdin = new PassThrough();
		const rl = createInterface({ input: stdin, crlfDelay: Infinity });
		const ipc = attachStdio(rl, { stdout: fakeStdout });

		stdin.write(
			'{"cmd":"start_session","id":"cmd-start","sessionId":"s2","workstreamId":"w2"}\n',
			'utf8',
		);
		stdin.end();

		await new Promise<void>((resolveP) => {
			rl.on('close', () => resolveP());
		});
		await ipc.drain();

		expect(ipc.manager.size()).toBe(1);
		expect(ipc.manager.list().map((r) => r.sessionId)).toEqual(['s2']);
		expect(ipc.manager.get('s2')?.status).toBe('idle');

		const parsedEvents = writes
			.filter((w) => w.endsWith('\n'))
			.map((w): AgentEvent => JSON.parse(w))
			.filter((event) => !event.type.startsWith('bridge.'));
		const sessionStates = parsedEvents.filter((event) => event.type === 'session.state');
		expect(sessionStates).toEqual([
			{
				type: 'session.state',
				sessionId: 's2',
				status: 'idle',
			},
		]);
		expect(sessionStates).not.toContainEqual(expect.objectContaining({ status: 'running' }));
	});

	it('createIpc.run fails start_session with an event line when no agent is registered', async () => {
		defaultProviderRegistry.clear();
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};

		const ipc = createIpc({ stdout: fakeStdout });
		await ipc.run('{"cmd":"start_session","id":"cmd-start","sessionId":"s","workstreamId":"w"}');

		const parsedEvents = writes
			.filter((w) => w.endsWith('\n'))
			.map((w): AgentEvent => JSON.parse(w))
			.filter((event) => !event.type.startsWith('bridge.'));
		expect(parsedEvents.find((e) => e.type === 'run.failed')?.type).toBe('run.failed');
	});

	it('refreshes capabilities in process, emits the snapshot before ack, and leaves sessions intact', async () => {
		registerTestProvider();
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		let probeCount = 0;
		const ipc = createIpc({
			stdout: fakeStdout,
			capabilityProbe: async () => {
				probeCount += 1;
				return capabilitySnapshot(probeCount === 1 ? 'needs_auth' : 'ready');
			},
		});
		await ipc.run(
			'{"cmd":"start_session","id":"start-existing","sessionId":"session-existing","workstreamId":"workstream-existing"}',
		);
		const sessionBefore = ipc.manager.get('session-existing');
		writes.length = 0;

		await ipc.run('{"cmd":"refresh_capabilities","id":"refresh-1"}');
		await ipc.run('{"cmd":"refresh_capabilities","id":"refresh-2"}');

		const frames = parseFrames(writes.join(''));
		expect(frames.map(({ type }) => type)).toEqual([
			'bridge.capabilities',
			'bridge.command_ack',
			'bridge.capabilities',
			'bridge.command_ack',
		]);
		expect(frames[1]?.id).toBe('refresh-1');
		expect(frames[3]?.id).toBe('refresh-2');
		expect(frames[0]?.capabilities?.map(({ state }) => state)).toEqual(['needs_auth']);
		expect(frames[2]?.capabilities?.map(({ state }) => state)).toEqual(['ready']);
		expect(frames[0]).not.toHaveProperty('providers');
		expect(frames[2]?.capabilities?.[0]).not.toHaveProperty('provider');
		expect(probeCount).toBe(2);
		expect(ipc.manager.size()).toBe(1);
		expect(ipc.manager.get('session-existing')).toBe(sessionBefore);
	});

	it('acknowledges a failed refresh with sanitized unknown capabilities', async () => {
		const secret = 'sk-secret-must-never-cross-the-wire';
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({
			stdout: fakeStdout,
			capabilityProbe: async () => {
				throw new Error(`provider returned ${secret}`);
			},
		});

		await ipc.run('{"cmd":"refresh_capabilities","id":"refresh-failed"}');

		const wire = writes.join('');
		const frames = parseFrames(wire);
		expect(frames.map(({ type }) => type)).toEqual(['bridge.capabilities', 'bridge.command_ack']);
		expect(frames[0]?.capabilities).toHaveLength(1);
		expect(frames[0]?.capabilities?.every(({ state }) => state === 'unknown')).toBe(true);
		expect(frames[1]?.id).toBe('refresh-failed');
		expect(wire).not.toContain(secret);
	});

	it('createIpc.run passes start_session worktreePath as provider cwd', async () => {
		let capturedCwd: string | null = null;
		defaultProviderRegistry.setProvider(async (ctx) => {
			capturedCwd = ctx.cwd;
			return {
				async sendPrompt() {
					return undefined;
				},
				async cancel() {
					return undefined;
				},
				async close() {
					return undefined;
				},
			};
		});
		const fakeStdout = createOutputSink();
		fakeStdout.write = (): boolean => true;
		const ipc = createIpc({ stdout: fakeStdout });

		await ipc.run(
			'{"cmd":"start_session","id":"cmd-start","sessionId":"s-cwd","workstreamId":"w-cwd","worktreePath":"/tmp/malini-ws"}',
		);

		expect(capturedCwd).toBe('/tmp/malini-ws');
	});

	it('passes the rewind point of a prompt to the provider', async () => {
		const received: Array<{ runId: string; profile?: AgentRunProfile; resumeAt?: string }> = [];
		defaultProviderRegistry.setProvider(async () => ({
			async sendPrompt(_prompt, runId, profile, resumeAt) {
				received.push({
					runId,
					...(profile ? { profile } : {}),
					...(resumeAt ? { resumeAt } : {}),
				});
			},
			async cancel() {},
			async close() {},
		}));
		const ipc = createIpc({ stdout: createOutputSink() });
		await ipc.run(
			'{"cmd":"start_session","id":"start-rewind","sessionId":"s-rewind","workstreamId":"w-rewind"}',
		);

		await ipc.run(
			'{"cmd":"send_prompt","id":"send-rewind","sessionId":"s-rewind","runId":"run-rewind","prompt":"retry","resumeAt":"assistant-uuid","profile":{"effort":"low","mode":"agent","access":"full"}}',
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send-plain","sessionId":"s-rewind","runId":"run-plain","prompt":"next"}',
		);
		await ipc.drain();

		expect(received).toEqual([
			{
				runId: 'run-rewind',
				profile: { effort: 'low', mode: 'agent', access: 'full' },
				resumeAt: 'assistant-uuid',
			},
			{ runId: 'run-plain' },
		]);
	});

	it('acknowledges cancel_run only after provider cancellation has finished', async () => {
		let releaseCancel!: () => void;
		const cancelGate = new Promise<void>((resolve) => {
			releaseCancel = resolve;
		});
		let cancelEntered!: () => void;
		const cancelStarted = new Promise<void>((resolve) => {
			cancelEntered = resolve;
		});
		defaultProviderRegistry.setProvider(async () => ({
			async sendPrompt() {},
			async cancel() {
				cancelEntered();
				await cancelGate;
			},
			async close() {},
		}));
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout });
		await ipc.run(
			`{"cmd":"start_session","id":"cancel-barrier-start","sessionId":"cancel-barrier-session","workstreamId":"cancel-barrier-workstream"}`,
		);
		writes.length = 0;

		const cancelling = ipc.run(
			'{"cmd":"cancel_run","id":"cancel-barrier","sessionId":"cancel-barrier-session","runId":"cancel-barrier-run"}',
		);
		await cancelStarted;
		expect(
			parseFrames(writes.join('')).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === 'cancel-barrier',
			),
		).toBeUndefined();

		releaseCancel();
		await cancelling;
		expect(
			parseFrames(writes.join('')).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === 'cancel-barrier',
			),
		).toMatchObject({ accepted: true });
	});

	it('writes the cancelled terminal before its ACK under stdout backpressure', async () => {
		defaultProviderRegistry.setProvider(async (_ctx, emit) => ({
			async sendPrompt() {},
			async cancel(runId) {
				emit({ type: 'run.failed', runId, error: 'cancelled' });
			},
			async close() {},
		}));
		const stream = new ManualBackpressureStream();
		const ipc = createIpc({ stdout: stream });
		await ipc.run(
			`{"cmd":"start_session","id":"cancel-output-start","sessionId":"cancel-output-session","workstreamId":"cancel-output-workstream"}`,
		);
		stream.release();
		await ipc.drain();
		stream.chunks.length = 0;
		stream.blockNextWrite();

		const cancelling = ipc.run(
			'{"cmd":"cancel_run","id":"cancel-output","sessionId":"cancel-output-session","runId":"cancel-output-run"}',
		);
		await Promise.resolve();
		let frames = parseFrames(stream.chunks.join(''));
		expect(frames[0]).toMatchObject({
			type: 'run.failed',
			runId: 'cancel-output-run',
			error: 'cancelled',
		});
		expect(
			frames.find((frame) => frame.type === 'bridge.command_ack' && frame.id === 'cancel-output'),
		).toBeUndefined();

		stream.release();
		await cancelling;
		await ipc.drain();
		frames = parseFrames(stream.chunks.join(''));
		expect(frames.map(({ type }) => type)).toEqual(['run.failed', 'bridge.command_ack']);
		expect(frames.at(-1)).toMatchObject({ id: 'cancel-output', accepted: true });
	});

	it('rejects cancel_run acknowledgement when provider cancellation fails', async () => {
		defaultProviderRegistry.setProvider(async () => ({
			async sendPrompt() {},
			async cancel() {
				throw new Error('secret provider diagnostic');
			},
			async close() {},
		}));
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout });
		await ipc.run(
			`{"cmd":"start_session","id":"cancel-failure-start","sessionId":"cancel-failure-session","workstreamId":"cancel-failure-workstream"}`,
		);
		writes.length = 0;

		await ipc.run(
			'{"cmd":"cancel_run","id":"cancel-failure","sessionId":"cancel-failure-session","runId":"cancel-failure-run"}',
		);
		const wire = writes.join('');
		expect(
			parseFrames(wire).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === 'cancel-failure',
			),
		).toMatchObject({
			accepted: false,
			error: 'CANCEL_FAILED: provider cancellation did not finish',
		});
		expect(wire).not.toContain('secret provider diagnostic');
	});

	it('acknowledges cancel_run when session bookkeeping throws unexpectedly', async () => {
		defaultProviderRegistry.setProvider(async () => ({
			async sendPrompt() {},
			async cancel() {},
			async close() {},
		}));
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout });
		await ipc.run(
			`{"cmd":"start_session","id":"cancel-bookkeeping-start","sessionId":"cancel-bookkeeping-session","workstreamId":"cancel-bookkeeping-workstream"}`,
		);
		ipc.manager.onLifecycle((event) => {
			if (event.kind === 'session.status') throw new Error('lifecycle listener failed');
		});
		writes.length = 0;

		await ipc.run(
			'{"cmd":"cancel_run","id":"cancel-bookkeeping","sessionId":"cancel-bookkeeping-session","runId":"cancel-bookkeeping-run"}',
		);

		expect(
			parseFrames(writes.join('')).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === 'cancel-bookkeeping',
			),
		).toMatchObject({
			accepted: false,
			error: 'CANCEL_STATE_FAILED: lifecycle listener failed',
		});
	});

	it('closes only the requested session after cancelling all of its active runs', async () => {
		const runReleases = new Map<string, () => void>();
		const calls: string[] = [];
		defaultProviderRegistry.setProvider(async (ctx) => ({
			async sendPrompt(_prompt, runId) {
				await new Promise<void>((resolve) => {
					runReleases.set(`${ctx.sessionId}:${runId}`, resolve);
				});
			},
			async cancel(runId) {
				calls.push(`cancel:${ctx.sessionId}:${runId}`);
				runReleases.get(`${ctx.sessionId}:${runId}`)?.();
			},
			async close() {
				calls.push(`close:${ctx.sessionId}`);
			},
		}));
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout, closeSessionTimeoutMs: 100 });

		for (const suffix of ['target', 'other']) {
			await ipc.run(
				`{"cmd":"start_session","id":"start-${suffix}","sessionId":"session-${suffix}","workstreamId":"workstream-${suffix}"}`,
			);
			await ipc.run(
				`{"cmd":"send_prompt","id":"send-${suffix}","sessionId":"session-${suffix}","runId":"run-${suffix}","prompt":"hold"}`,
			);
		}

		await ipc.run('{"cmd":"close_session","id":"close-target","sessionId":"session-target"}');

		expect(calls).toEqual(['cancel:session-target:run-target', 'close:session-target']);
		expect(ipc.manager.get('session-target')).toBeUndefined();
		expect(ipc.manager.get('session-other')).toBeDefined();
		expect(
			parseFrames(writes.join('')).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === 'close-target',
			),
		).toMatchObject({ accepted: true });

		await ipc.run('{"cmd":"close_session","id":"close-other","sessionId":"session-other"}');
		await ipc.drain();
	});

	it('rejects close_session on a bounded close timeout and keeps session state recoverable', async () => {
		const calls: string[] = [];
		defaultProviderRegistry.setProvider(async (ctx) => ({
			async sendPrompt() {},
			async cancel() {},
			async close() {
				calls.push(`close:${ctx.sessionId}`);
				await new Promise<void>(() => undefined);
			},
		}));
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout, closeSessionTimeoutMs: 10 });
		for (const suffix of ['target', 'other']) {
			await ipc.run(
				`{"cmd":"start_session","id":"timeout-start-${suffix}","sessionId":"timeout-session-${suffix}","workstreamId":"timeout-workstream-${suffix}"}`,
			);
		}

		await ipc.run(
			'{"cmd":"close_session","id":"timeout-close-target","sessionId":"timeout-session-target"}',
		);

		expect(calls).toEqual(['close:timeout-session-target']);
		expect(ipc.manager.get('timeout-session-target')).toBeDefined();
		expect(ipc.manager.get('timeout-session-other')).toBeDefined();
		expect(
			parseFrames(writes.join('')).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === 'timeout-close-target',
			),
		).toMatchObject({
			accepted: false,
			error: 'CLOSE_SESSION_FAILED: provider session close exceeded 10ms',
		});
	});

	it('treats repeated start_session for the same live session as an idempotent re-registration', async () => {
		let factoryCalls = 0;
		defaultProviderRegistry.setProvider(async () => {
			factoryCalls += 1;
			return {
				async sendPrompt() {},
				async cancel() {},
				async close() {},
			};
		});
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout });
		const command = `{"cmd":"start_session","id":"cmd-first","sessionId":"same-session","workstreamId":"same-workstream","model":"sonnet"}`;

		await ipc.run(command);
		await ipc.run(command.replace('cmd-first', 'cmd-second'));

		expect(factoryCalls).toBe(1);
		expect(ipc.manager.size()).toBe(1);
		expect(writes.join('')).not.toContain('ALREADY_OPEN');
	});

	it('reactivates a live session after its provider session id becomes durable', async () => {
		const contexts: ProviderContext[] = [];
		let closeCalls = 0;
		defaultProviderRegistry.setProvider(async (ctx, emit) => {
			contexts.push(ctx);
			emit({
				type: 'session.state',
				sessionId: ctx.sessionId,
				status: 'idle',
				providerSessionId: ctx.providerSessionId ?? 'provider-thread-durable',
			});
			return {
				async sendPrompt() {},
				async cancel() {},
				async close() {
					closeCalls += 1;
				},
			};
		});
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout });
		const ackFor = (id: string): WireFrame | undefined =>
			parseFrames(writes.join('')).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === id,
			);

		await ipc.run(
			`{"cmd":"start_session","id":"first-provider-id","sessionId":"evolving-session","workstreamId":"evolving-workstream"}`,
		);
		expect(ipc.manager.get('evolving-session')?.providerSessionId).toBe('provider-thread-durable');
		await ipc.run(
			`{"cmd":"start_session","id":"reactivate-provider-id","sessionId":"evolving-session","workstreamId":"evolving-workstream","providerSessionId":"provider-thread-durable"}`,
		);

		expect(contexts).toHaveLength(1);
		expect(ackFor('reactivate-provider-id')).toMatchObject({ accepted: true });

		await ipc.run(
			`{"cmd":"start_session","id":"other-provider-id","sessionId":"evolving-session","workstreamId":"evolving-workstream","providerSessionId":"different-provider-thread"}`,
		);

		expect(ackFor('other-provider-id')).toMatchObject({ accepted: true });
		expect(closeCalls).toBe(1);
		expect(contexts.map(({ providerSessionId }) => providerSessionId)).toEqual([
			undefined,
			'different-provider-thread',
		]);
		expect(ipc.manager.get('evolving-session')?.providerSessionId).toBe(
			'different-provider-thread',
		);
		expect(writes.join('')).not.toContain('ALREADY_OPEN');
	});

	it('rebinds an idle session to a new model with a fresh provider handle', async () => {
		const contexts: ProviderContext[] = [];
		const calls: string[] = [];
		defaultProviderRegistry.setProvider(async (ctx) => {
			contexts.push(ctx);
			return {
				async sendPrompt(prompt) {
					calls.push(`${ctx.model}:${prompt}`);
				},
				async cancel() {},
				async close() {
					calls.push(`close:${ctx.model}`);
				},
			};
		});
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout });
		const ackFor = (id: string): WireFrame | undefined =>
			parseFrames(writes.join('')).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === id,
			);

		await ipc.run(
			`{"cmd":"start_session","id":"start-sonnet","sessionId":"model-session","workstreamId":"model-workstream","model":"sonnet","providerSessionId":"claude-session"}`,
		);
		await ipc.run(
			`{"cmd":"start_session","id":"start-opus","sessionId":"model-session","workstreamId":"model-workstream","model":"opus"}`,
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send-opus","sessionId":"model-session","runId":"run-opus","prompt":"hello"}',
		);
		await ipc.drain();

		expect(ackFor('start-opus')).toMatchObject({ accepted: true });
		expect(calls).toEqual(['close:sonnet', 'opus:hello']);
		expect(contexts.map(({ model }) => model)).toEqual(['sonnet', 'opus']);
		expect(ipc.manager.get('model-session')?.model).toBe('opus');
		expect(ipc.manager.size()).toBe(1);

		await ipc.run(
			`{"cmd":"start_session","id":"start-moved","sessionId":"model-session","workstreamId":"another-workstream","model":"opus"}`,
		);
		expect(ackFor('start-moved')).toMatchObject({
			accepted: false,
			error: expect.stringContaining('ALREADY_OPEN'),
		});
	});

	it('queues a prompt behind asynchronous provider startup for the same session', async () => {
		let releaseFactory!: () => void;
		const factoryGate = new Promise<void>((resolve) => {
			releaseFactory = resolve;
		});
		let factoryEntered!: () => void;
		const factoryStarted = new Promise<void>((resolve) => {
			factoryEntered = resolve;
		});
		const prompts: string[] = [];
		defaultProviderRegistry.setProvider(async () => {
			factoryEntered();
			await factoryGate;
			return {
				async sendPrompt(prompt) {
					prompts.push(prompt);
				},
				async cancel() {},
				async close() {},
			};
		});
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout });
		const start = ipc.run(
			`{"cmd":"start_session","id":"start-slow","sessionId":"slow-session","workstreamId":"slow-workstream"}`,
		);
		await factoryStarted;
		expect(
			parseFrames(writes.join('')).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === 'start-slow',
			),
		).toBeUndefined();
		const send = ipc.run(
			'{"cmd":"send_prompt","id":"send-slow","sessionId":"slow-session","runId":"slow-run","prompt":"after start"}',
		);
		releaseFactory();
		await Promise.all([start, send]);
		await ipc.drain();

		expect(prompts).toEqual(['after start']);
		expect(writes.join('')).not.toContain('NO_SESSION');
		expect(
			parseFrames(writes.join('')).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === 'start-slow',
			),
		).toMatchObject({ accepted: true });
	});

	it('rejects start_session acknowledgement when provider registration fails', async () => {
		defaultProviderRegistry.setProvider(async () => {
			throw new Error('provider handle could not boot');
		});
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout });

		await ipc.run(
			`{"cmd":"start_session","id":"start-failed","sessionId":"failed-session","workstreamId":"failed-workstream"}`,
		);

		const ack = parseFrames(writes.join('')).find(
			(frame) => frame.type === 'bridge.command_ack' && frame.id === 'start-failed',
		);
		expect(ack).toMatchObject({
			accepted: false,
			error: 'START_SESSION_FAILED: provider handle could not boot',
		});
		expect(ipc.manager.get('failed-session')?.status).toBe('failed');
	});

	it('refuses a model rebind while the existing handle is running', async () => {
		let releaseRun!: () => void;
		const runGate = new Promise<void>((resolve) => {
			releaseRun = resolve;
		});
		let factoryCalls = 0;
		let closeCalls = 0;
		defaultProviderRegistry.setProvider(async () => {
			factoryCalls += 1;
			return {
				async sendPrompt() {
					await runGate;
				},
				async cancel() {},
				async close() {
					closeCalls += 1;
				},
			};
		});
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout });
		await ipc.run(
			`{"cmd":"start_session","id":"start-active","sessionId":"active-session","workstreamId":"active-workstream","model":"sonnet"}`,
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send-active","sessionId":"active-session","runId":"active-run","prompt":"hold"}',
		);
		await ipc.run(
			`{"cmd":"start_session","id":"rebind-active","sessionId":"active-session","workstreamId":"active-workstream","model":"opus"}`,
		);

		expect(factoryCalls).toBe(1);
		expect(closeCalls).toBe(0);
		expect(ipc.manager.get('active-session')?.model).toBe('sonnet');
		expect(
			parseFrames(writes.join('')).find(
				(frame) => frame.type === 'bridge.command_ack' && frame.id === 'rebind-active',
			),
		).toMatchObject({
			accepted: false,
			error:
				'SESSION_BUSY: session active-session has an active run; wait for it to finish before changing its model',
		});

		releaseRun();
		await ipc.drain();
	});

	it('keeps a session active when an overlapping prompt fails before the first run finishes', async () => {
		let releaseFirstRun!: () => void;
		const firstRunGate = new Promise<void>((resolve) => {
			releaseFirstRun = resolve;
		});
		let markSecondRunRejected!: () => void;
		const secondRunRejected = new Promise<void>((resolve) => {
			markSecondRunRejected = resolve;
		});
		let factoryCalls = 0;
		let closeCalls = 0;
		defaultProviderRegistry.setProvider(async () => {
			factoryCalls += 1;
			return {
				async sendPrompt(_prompt, runId) {
					if (runId === 'first-run') {
						await firstRunGate;
						return;
					}
					markSecondRunRejected();
					throw new Error('overlapping run rejected');
				},
				async cancel() {},
				async close() {
					closeCalls += 1;
				},
			};
		});
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};
		const ipc = createIpc({ stdout: fakeStdout });
		await ipc.run(
			`{"cmd":"start_session","id":"start-overlap","sessionId":"overlap-session","workstreamId":"overlap-workstream","model":"sonnet"}`,
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send-first","sessionId":"overlap-session","runId":"first-run","prompt":"hold"}',
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send-second","sessionId":"overlap-session","runId":"second-run","prompt":"reject"}',
		);
		await secondRunRejected;
		await ipc.run(
			`{"cmd":"start_session","id":"rebind-overlap","sessionId":"overlap-session","workstreamId":"overlap-workstream","model":"opus"}`,
		);

		expect(factoryCalls).toBe(1);
		expect(closeCalls).toBe(0);
		expect(ipc.manager.get('overlap-session')?.model).toBe('sonnet');
		expect(writes.join('')).toContain('SESSION_BUSY');

		releaseFirstRun();
		await ipc.drain();
	});

	it('does not block a second checkout while the first provider run is active', async () => {
		let releaseRuns!: () => void;
		const runGate = new Promise<void>((resolve) => {
			releaseRuns = resolve;
		});
		const startedRuns: string[] = [];
		defaultProviderRegistry.setProvider(async (ctx, emit) => ({
			async sendPrompt(_prompt, runId) {
				startedRuns.push(`${ctx.workstreamId}:${runId}`);
				emit({ type: 'run.started', runId, sessionId: ctx.sessionId });
				await runGate;
				emit({ type: 'run.completed', runId, summary: 'done' });
			},
			async cancel() {},
			async close() {},
		}));
		const fakeStdout = createOutputSink();
		fakeStdout.write = (): boolean => true;
		const ipc = createIpc({ stdout: fakeStdout });

		await ipc.run(
			`{"cmd":"start_session","id":"start-a","sessionId":"session-a","workstreamId":"workstream-a"}`,
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send-a","sessionId":"session-a","runId":"run-a","prompt":"first"}',
		);
		await ipc.run(
			`{"cmd":"start_session","id":"start-b","sessionId":"session-b","workstreamId":"workstream-b"}`,
		);
		await ipc.run(
			'{"cmd":"send_prompt","id":"send-b","sessionId":"session-b","runId":"run-b","prompt":"second"}',
		);

		expect(startedRuns).toEqual(['workstream-a:run-a', 'workstream-b:run-b']);
		expect(ipc.inFlight()).toBe(2);

		releaseRuns();
		await ipc.drain();
		expect(ipc.inFlight()).toBe(0);
	});

	it('test-only provider registration is idempotent', () => {
		registerTestProvider();
		registerTestProvider();
		expect(defaultProviderRegistry.hasProvider()).toBe(true);
	});

	it('runCli integrates readline -> IPC -> exit cleanly when stdin closes immediately', async () => {
		const stdin = new PassThrough();
		stdin.end();
		const writes: string[] = [];
		const fakeStdout = createOutputSink();
		fakeStdout.write = (chunk: string): boolean => {
			writes.push(chunk);
			return true;
		};

		let exitCode: number | null = null;
		const exit = (code: number): void => {
			exitCode = code;
		};

		void runCli({
			stdin,
			stdout: fakeStdout,
			idleTimeoutMs: 50,
			exit,
			capabilityProbe: async () => {
				throw new Error('probe explosion');
			},
		});
		await new Promise<void>((resolveP) => {
			const interval = setInterval(() => {
				if (exitCode !== null) {
					clearInterval(interval);
					resolveP();
				}
			}, 10);
		});
		expect(exitCode).toBe(0);
		const ready = parseFrames(writes.join('')).find((frame) => frame.type === 'bridge.ready');
		expect(ready).not.toHaveProperty('providers');
		expect(ready?.capabilities).toHaveLength(1);
		expect(ready?.capabilities?.every(({ state }) => state === 'unknown')).toBe(true);
	}, 5_000);

	it('runCli stays alive by default while stdin remains open', async () => {
		const stdin = new PassThrough();
		const fakeStdout = createOutputSink();

		let exitCode: number | null = null;
		const exit = (code: number): void => {
			exitCode = code;
		};

		void runCli({
			stdin,
			stdout: fakeStdout,
			exit,
			capabilityProbe: async () => unknownCapability('test probe'),
		});
		await new Promise((resolveP) => setTimeout(resolveP, 75));
		expect(exitCode).toBeNull();

		stdin.end();
		await new Promise<void>((resolveP) => {
			const interval = setInterval(() => {
				if (exitCode !== null) {
					clearInterval(interval);
					resolveP();
				}
			}, 10);
		});
		expect(exitCode).toBe(0);
	}, 5_000);

	it('SessionManager unit surface (sanity)', () => {
		const m = new SessionManager();
		m.register({ sessionId: 'a', workstreamId: 'w' });
		m.unregister('a');
		expect(m.size()).toBe(0);
	});

	it('UnknownProviderError thrown by getProvider when no factory registered', async () => {
		defaultProviderRegistry.clear();
		await expect(
			defaultProviderRegistry.getProvider(
				{ sessionId: 'sx', workstreamId: 'wx', cwd: '/tmp' },
				() => undefined,
			),
		).rejects.toBeInstanceOf(UnknownProviderError);
	});
});
