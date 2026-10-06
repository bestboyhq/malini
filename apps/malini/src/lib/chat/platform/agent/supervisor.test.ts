import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeProcessFactory } from './process';
import {
	BRIDGE_CONTRACT_NAME,
	BRIDGE_HEARTBEAT_TIMEOUT_MS,
	BRIDGE_MAX_FRAME_BYTES,
	BRIDGE_PROTOCOL_VERSION,
	type BridgeEvent,
} from './protocol';
import {
	appendDiagnosticTail,
	backoffForAttempt,
	BoundedLineSplitter,
	BridgeSupervisor,
	SupervisorError,
} from './supervisor';
import { waitFor, writeFakeBridge, type FakeBridge } from './test-support';

const cleanups: Array<() => Promise<void> | void> = [];
let fake: FakeBridge;

afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

function fixture(): FakeBridge {
	fake = writeFakeBridge();
	cleanups.push(() => fake.cleanup());
	return fake;
}

async function spawn(
	env: Record<string, string> = {},
	overrides: Parameters<FakeBridge['supervisorConfig']>[1] = {},
) {
	const supervisor = await BridgeSupervisor.spawn(fixture().supervisorConfig(env, overrides));
	cleanups.push(() => supervisor.kill().catch(() => undefined));
	return supervisor;
}

function startSession(id: string, sessionId = 'sess-1') {
	return { cmd: 'start_session' as const, id, sessionId, workstreamId: 'ws-1' };
}

describe('BridgeSupervisor against the scripted fake bridge', () => {
	it('handshakes, reports healthy, and correlates a command with its ack', async () => {
		const supervisor = await spawn();
		expect(supervisor.isHealthy()).toBe(true);
		expect(supervisor.health()).toMatchObject({ state: 'healthy', pid: supervisor.pid() });
		expect(supervisor.providerCapabilities()).toEqual([
			expect.objectContaining({
				state: 'ready',
				version: 'fixture-1.0.0',
				message: 'Ready',
			}),
		]);
		const events: BridgeEvent[] = [];
		supervisor.onEvent((event) => events.push(event));
		await supervisor.sendCommand(startSession('cmd-1'));
		await waitFor(() => events.length === 1);
		expect(events[0]).toEqual({
			type: 'session.state',
			sessionId: 'sess-1',
			status: 'idle',
			providerSessionId: 'prov-sess-1',
		});
	});

	it('surfaces a rejected command as the bridge protocol error text', async () => {
		const supervisor = await spawn({
			FAKE_BRIDGE_REJECT_START: 'START_SESSION_FAILED: provider handle could not boot',
		});
		await expect(supervisor.sendCommand(startSession('cmd-2'))).rejects.toThrow(
			'bridge protocol error: START_SESSION_FAILED: provider handle could not boot',
		);
	});

	it('correlates reverse-order acks for concurrent commands and rejects a duplicate id', async () => {
		const supervisor = await spawn({ FAKE_BRIDGE_REVERSE_ACKS: '3' });
		await Promise.all([
			supervisor.sendCommand(startSession('cmd-a', 'a')),
			supervisor.sendCommand(startSession('cmd-b', 'b')),
			supervisor.sendCommand(startSession('cmd-c', 'c')),
		]);
		const first = supervisor.sendCommand(startSession('dup', 'd'));
		await expect(supervisor.sendCommand(startSession('dup', 'e'))).rejects.toThrow(
			'duplicate in-flight command correlation id `dup`',
		);
		void first.catch(() => undefined);
		expect(supervisor.isHealthy()).toBe(true);
	});

	it('times out an unacknowledged command with the budget in the message', async () => {
		const supervisor = await spawn({ FAKE_BRIDGE_REVERSE_ACKS: '9' });
		const pending = supervisor.sendCommand({
			cmd: 'cancel_run',
			id: 'slow',
			sessionId: 's',
			runId: 'r',
		});
		await expect(pending).rejects.toThrow('command slow was not acknowledged within 5000ms');
	}, 10_000);

	it('replaces the capability snapshot on refresh and refuses an ack without a frame', async () => {
		const supervisor = await spawn();
		const refreshed = await supervisor.refreshProviderCapabilities();
		expect(refreshed[0]).toMatchObject({ version: 'fixture-2.0.0', message: 'Refreshed' });
		expect(supervisor.providerCapabilities()[0]).toMatchObject({ version: 'fixture-2.0.0' });

		const silent = await spawn({ FAKE_BRIDGE_SKIP_CAPABILITIES_FRAME: '1' });
		await expect(silent.refreshProviderCapabilities()).rejects.toThrow(
			'capability refresh was acknowledged without a validated bridge.capabilities frame',
		);
		expect(silent.providerCapabilities()[0]).toMatchObject({ version: 'fixture-1.0.0' });
	});

	it('fails the handshake on a protocol version mismatch and kills the child', async () => {
		const bridge = fixture();
		await expect(
			BridgeSupervisor.spawn(
				bridge.supervisorConfig({ FAKE_BRIDGE_VERSION: String(BRIDGE_PROTOCOL_VERSION + 1) }),
			),
		).rejects.toThrow(
			`bridge protocol error: PROTOCOL_MISMATCH: expected ${BRIDGE_CONTRACT_NAME} v${BRIDGE_PROTOCOL_VERSION} heartbeat=1000ms, got ${BRIDGE_CONTRACT_NAME} v${BRIDGE_PROTOCOL_VERSION + 1} heartbeat=1000ms`,
		);
	});

	it('fails the handshake when a ready capability is inconsistent', async () => {
		const bridge = fixture();
		await expect(
			BridgeSupervisor.spawn(bridge.supervisorConfig({ FAKE_BRIDGE_BAD_CAPABILITY: '1' })),
		).rejects.toThrow('BAD_READY_FRAME: a ready agent must report authenticated=true');
	});

	it('captures child stderr in a spawn failure', async () => {
		const bridge = fixture();
		const error = await BridgeSupervisor.spawn(
			bridge.supervisorConfig({ FAKE_BRIDGE_STDERR_EXIT: 'boom: provider module missing' }),
		).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(SupervisorError);
		expect(messageOf(error)).toContain(
			'agent bridge exited; stderr: boom: provider module missing',
		);
	});

	it('reports a missing script as a spawn failure', async () => {
		const bridge = fixture();
		const config = bridge.supervisorConfig();
		await expect(
			BridgeSupervisor.spawn({
				...config,
				spawn: { ...config.spawn, scriptPath: join(bridge.dir, 'missing.cjs') },
			}),
		).rejects.toThrow(/bridge protocol error: agent bridge (exited|process exited)/);
	});

	it('turns a stale heartbeat into unhealthy with the age in the reason', async () => {
		let clock = Date.now();
		const supervisor = await spawn({ FAKE_BRIDGE_HEARTBEAT_MS: '0' }, { now: () => clock });
		expect(supervisor.isHealthy()).toBe(true);
		clock += BRIDGE_HEARTBEAT_TIMEOUT_MS + 1;
		expect(supervisor.isHealthy()).toBe(false);
		expect(supervisor.unavailableReason()).toBe(
			`agent bridge heartbeat is stale (${BRIDGE_HEARTBEAT_TIMEOUT_MS + 1}ms; timeout ${BRIDGE_HEARTBEAT_TIMEOUT_MS}ms)`,
		);
		await expect(supervisor.sendCommand(startSession('stale'))).rejects.toThrow(
			'heartbeat is stale',
		);
		expect(supervisor.health()).toEqual({ state: 'crashed', lastExit: 0 });
	});

	it('kills the process group and reports killed', async () => {
		const supervisor = await spawn();
		const pid = supervisor.pid();
		expect(pid).not.toBeNull();
		await supervisor.kill();
		expect(supervisor.isHealthy()).toBe(false);
		expect(supervisor.health()).toEqual({ state: 'killed' });
		expect(supervisor.pid()).toBeNull();
		await waitFor(() => !isAlive(pid ?? 0));
		await expect(supervisor.sendCommand(startSession('after-kill'))).rejects.toThrow(
			'bridge protocol error',
		);
	});

	it('restarts with backoff into a live replacement child', async () => {
		const supervisor = await spawn();
		const oldPid = supervisor.pid();
		const replacement = await supervisor.restartWithBackoff(0);
		cleanups.push(() => replacement.kill().catch(() => undefined));
		expect(replacement.isHealthy()).toBe(true);
		expect(replacement.pid()).not.toBe(oldPid);
		expect(supervisor.isHealthy()).toBe(false);
	});

	it('notices a child that exits on its own and fails its pending acks', async () => {
		const supervisor = await spawn();
		const events: BridgeEvent[] = [];
		supervisor.onEvent((event) => events.push(event));
		const pending = supervisor.sendCommand({
			cmd: 'send_prompt',
			id: 'crash',
			sessionId: 's',
			runId: 'r',
			prompt: 'CRASH',
		});
		await pending;
		await waitFor(() => !supervisor.isHealthy());
		expect(supervisor.unavailableReason()).toBe('agent bridge process exited');
	});
});

describe('frame handling without a child', () => {
	it('bounds a line at the frame ceiling and keeps framing afterwards', () => {
		const lines: string[] = [];
		let tooLarge = 0;
		const splitter = new BoundedLineSplitter(
			16,
			(line) => lines.push(line),
			() => (tooLarge += 1),
		);
		splitter.push(Buffer.from('{"a":1}\n'));
		splitter.push(Buffer.from('x'.repeat(40)));
		splitter.push(Buffer.from('\n{"b":2}\r\n'));
		splitter.push(Buffer.from('{"c":3}'));
		splitter.end();
		expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
		expect(tooLarge).toBe(1);
		expect(BRIDGE_MAX_FRAME_BYTES).toBe(1_048_576);
	});

	it('keeps the stderr tail bounded and the backoff schedule capped', () => {
		let tail = '';
		for (let index = 0; index < 400; index += 1)
			tail = appendDiagnosticTail(tail, `line ${index} ${'x'.repeat(60)}`);
		expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(16_384);
		expect(tail.endsWith('line 399 ' + 'x'.repeat(60) + '\n')).toBe(true);
		expect([1, 2, 3, 4, 5, 6, 7, 99].map(backoffForAttempt)).toEqual([
			1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
		]);
		expect(backoffForAttempt(0)).toBe(1000);
	});

	it('routes a bad event frame with a runId into a visible run failure', async () => {
		const bridge = fixture();
		const echo = join(bridge.dir, 'echo.cjs');
		const { writeFileSync } = await import('node:fs');
		writeFileSync(
			echo,
			"process.stdin.pipe(process.stdout); process.stdin.on('end', () => process.exit(0));",
		);
		const supervisor = await BridgeSupervisor.spawn({
			processFactory: createNodeProcessFactory(),
			spawn: { scriptPath: echo, args: [], env: { PATH: process.env['PATH'] ?? '' } },
			protocolRequired: false,
			log: () => {},
		});
		cleanups.push(() => supervisor.kill().catch(() => undefined));
		const events: BridgeEvent[] = [];
		supervisor.onEvent((event) => events.push(event));
		supervisor.writeRawLine(JSON.stringify({ type: 'tool.started', runId: 'run-bad' }));
		supervisor.writeRawLine(
			JSON.stringify({ type: 'file.changed', runId: 'run-ok', path: 'a.ts' }),
		);
		supervisor.writeRawLine('not json');
		await waitFor(() => events.length === 2);
		expect(events[0]).toEqual({
			type: 'run.failed',
			runId: 'run-bad',
			error: 'BAD_EVENT_FRAME: tool.started: field `name` must be a string',
		});
		expect(events[1]).toEqual({ type: 'file.changed', runId: 'run-ok', path: 'a.ts' });
		await waitFor(
			() =>
				supervisor.protocolError() ===
				'BAD_FRAME: malformed child JSON: Unexpected token \'o\', "not json" is not valid JSON',
		);
	});
});

const REAL_CLI = join(__dirname, '../../../../../../../packages/agent-bridge/dist/cli.js');

describe.skipIf(!existsSync(REAL_CLI))('BridgeSupervisor against the built agent bridge', () => {
	it('completes the real bridge.ready handshake and acknowledges a command', async () => {
		const supervisor = await BridgeSupervisor.spawn({
			processFactory: createNodeProcessFactory(),
			spawn: {
				scriptPath: REAL_CLI,
				args: ['--stdio'],
				env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: process.env['HOME'] ?? '/tmp' },
			},
			log: () => {},
		});
		cleanups.push(() => supervisor.kill().catch(() => undefined));
		expect(supervisor.isHealthy()).toBe(true);
		expect(supervisor.providerCapabilities()).toHaveLength(1);
		await supervisor
			.sendCommand({ cmd: 'refresh_mcp_status', id: 'real-1', sessionId: 'missing', runId: 'r' })
			.catch((error: unknown) => {
				expect(messageOf(error)).toContain('NO_SESSION');
			});
	}, 20_000);
});

if (!existsSync(REAL_CLI)) {
	console.error(
		`agent bridge dist is missing at ${REAL_CLI}; run \`corepack pnpm --filter @malini/agent-bridge build\` to run the real handshake test`,
	);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isAlive(pid: number): boolean {
	if (pid === 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM';
	}
}
