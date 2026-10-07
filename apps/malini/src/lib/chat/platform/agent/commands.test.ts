import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKSTREAM_FOLDER_MISSING } from '$main/errors';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import { listEventRowsForSession } from '../events.repository';
import { getInteraction } from '../interactions.repository';
import { get, isRecord, run, scalar } from '$main/db/rows';
import { getRun } from '../runs.repository';
import { getSession } from '../sessions.repository';
import { getWorkstream } from '$shared/repositories/repositories.platform';
import { REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL } from '$contract/events';
import { PAUSED_FOR_EXIT_ERROR } from '$contract/agent-state-machine';
import { CommandRegistry } from '$main/ipc/registry';
import {
	BRIDGE_COMMAND_NAMES,
	CONTINUE_AFTER_PAUSE_PROMPT,
	promptWithElementReferences,
	promptWithWorkstreamContext,
	type CheckpointCaptureInput,
} from './commands';
import { AgentRunLeases } from './lifecycle';
import { startAgentService, type AgentService } from './service';
import type { RunFinishedInput } from './runtime';
import {
	createTestContext,
	envelopesOn,
	externalReadPath,
	seedOpenRun,
	seedSession,
	seedWorkstream,
	waitFor,
	writeFakeBridge,
	type FakeBridge,
	type TestContext,
} from './test-support';

let test: TestContext;
let fake: FakeBridge;
let service: AgentService;

beforeEach(async () => {
	test = createTestContext();
	fake = writeFakeBridge();
});

afterEach(async () => {
	await service?.stop();
	fake.cleanup();
	test.cleanup();
});

function recordCheckpoint({ workstreamId, sessionId, runId }: CheckpointCaptureInput): string {
	run(
		test.db,
		`INSERT INTO agent_checkpoints
		 (id, workstream_id, session_id, run_id, user_message_seq, git_ref, git_commit, created_at)
		 VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
		`ckpt-${runId}`,
		workstreamId,
		sessionId,
		runId,
		`refs/malini/checkpoints/${workstreamId}/${runId}`,
		'deadbeef',
		new Date().toISOString(),
	);
	return `ckpt-${runId}`;
}

async function boot(
	env: Record<string, string> = {},
	extra: Partial<Parameters<typeof startAgentService>[1]> = {},
): Promise<void> {
	service = await startAgentService(test.context, {
		processFactory: fake.supervisorConfig().processFactory,
		bridgeScriptPath: fake.scriptPath,
		spawnEnvironment: () => ({ PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...env }),
		leases: new AgentRunLeases(),
		hooks: { captureCheckpoint: (input) => Promise.resolve(recordCheckpoint(input)) },
		log: () => {},
		...extra,
	});
}

async function invoke(command: string, args: unknown = {}): Promise<unknown> {
	const response = await test.context.commands.invoke({ command, args });
	if (!response.ok) throw new Error(response.error);
	return response.value;
}

async function invokeString(command: string, args: unknown = {}): Promise<string> {
	const value = await invoke(command, args);
	if (typeof value !== 'string') throw new Error(`${command} did not return a string`);
	return value;
}

async function invokeBoolean(command: string, args: unknown = {}): Promise<boolean> {
	const value = await invoke(command, args);
	if (typeof value !== 'boolean') throw new Error(`${command} did not return a boolean`);
	return value;
}

async function invokeNumber(command: string, args: unknown = {}): Promise<number> {
	const value = await invoke(command, args);
	if (typeof value !== 'number') throw new Error(`${command} did not return a number`);
	return value;
}

async function invokeRecord(command: string, args: unknown = {}): Promise<Record<string, unknown>> {
	const value = await invoke(command, args);
	if (!isRecord(value)) throw new Error(`${command} did not return an object`);
	return value;
}

async function invokeRecords(
	command: string,
	args: unknown = {},
): Promise<Array<Record<string, unknown>>> {
	const value = await invoke(command, args);
	if (!Array.isArray(value)) throw new Error(`${command} did not return an array`);
	return value.map((item: unknown) => {
		if (!isRecord(item)) throw new Error(`${command} item is not an object`);
		return item;
	});
}

function eventType(envelope: Record<string, unknown>): unknown {
	const event = envelope['event'];
	return isRecord(event) ? event['type'] : undefined;
}

async function invokeError(command: string, args: unknown = {}): Promise<string> {
	const response = await test.context.commands.invoke({ command, args });
	if (response.ok) throw new Error(`expected ${command} to fail`);
	return response.error;
}

describe('registration', () => {
	it('defines the sixteen commands, starts the bridge, and reaps orphans from the last process', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-old', 'ws-1', 'running');
		seedOpenRun(test.db, 'run-old', 'sess-old');
		await boot();
		expect(service.started).toBe(true);
		expect(service.health()).toMatchObject({ state: 'healthy' });
		expect(test.context.commands.names()).toEqual([...BRIDGE_COMMAND_NAMES].sort());
		expect(getRun(test.db, 'run-old')).toMatchObject({ error: 'interrupted: app closed mid-run' });
		expect(getSession(test.db, 'sess-old')?.status).toBe('idle');
		expect(await invokeBoolean('chat.agent-health')).toBe(true);
	});

	it('boots without a bridge script and answers commands with the reason', async () => {
		fake.cleanup();
		await boot();
		expect(service.started).toBe(false);
		expect(service.health()).toEqual({ state: 'pending' });
		expect(await invokeBoolean('chat.agent-health')).toBe(false);
		expect(await invokeError('chat.restart-agent')).toMatch(/^agent bridge restart failed: /);
		expect(await invokeError('chat.reset-workstream-runs', { workstreamId: 'ws-1' })).toMatch(
			/^agent bridge is not running/,
		);
	}, 10_000);
});

describe('session commands', () => {
	it('starts, lists, gets-or-creates, activates, and archives a session', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const sessionId = await invokeString('chat.start-session', {
			workstreamId: 'ws-1',
			model: 'sonnet',
		});
		expect(sessionId).toMatch(/^sess-\d+-\d+$/);
		expect(getSession(test.db, sessionId)).toMatchObject({
			workstreamId: 'ws-1',
			status: 'idle',
		});

		const summaries = await invokeRecords('chat.list-sessions', {
			workstreamId: 'ws-1',
		});
		expect(summaries).toEqual([
			{
				id: sessionId,
				workstreamId: 'ws-1',
				displayName: 'New chat',
				model: 'sonnet',
				status: 'idle',
				startedAt: expect.any(String),
			},
		]);

		expect(
			await invokeString('chat.get-or-create-session', {
				workstreamId: 'ws-1',
			}),
		).toBe(sessionId);
		await invoke('chat.activate-session', { sessionId });
		await invoke('chat.archive-session', { sessionId });
		expect(await invoke('chat.list-sessions', { workstreamId: 'ws-1' })).toEqual([]);
		const fresh = await invokeString('chat.get-or-create-session', {
			workstreamId: 'ws-1',
		});
		expect(fresh).not.toBe(sessionId);
	});

	it('activates a chat whose workstream folder is gone so it stays readable, and refuses its prompts', async () => {
		const checkout = seedWorkstream(test.db, test.appDataRoot, 'ws-gone');
		seedSession(test.db, 'sess-gone', 'ws-gone', 'idle', 'anthropic/claude-sonnet-4-6');
		await boot();
		rmSync(checkout, { recursive: true, force: true });

		await invoke('chat.activate-session', { sessionId: 'sess-gone' });

		expect(await invokeError('chat.send-prompt', { sessionId: 'sess-gone', prompt: 'x' })).toBe(
			WORKSTREAM_FOLDER_MISSING,
		);
	});

	it('moves a model persisted before Claude Code to its family and names the error strings the renderer matches on', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-stale', 'ws-1', 'running', 'anthropic/claude-opus-4-8');
		await boot();
		const [summary] = await invokeRecords('chat.list-sessions', {
			workstreamId: 'ws-1',
		});
		expect(summary).toMatchObject({ model: 'opus', status: 'idle' });
		expect(getSession(test.db, 'sess-stale')?.model).toBe('opus');

		expect(
			await invokeError('chat.start-session', {
				workstreamId: 'ws-1',
				model: 'openai/nope',
			}),
		).toBe('invalid agent model: model `openai/nope` is not in the agent catalog');
		expect(await invokeError('chat.start-session', { workstreamId: 'ws-none' })).toBe(
			WORKSTREAM_FOLDER_MISSING,
		);
		expect(await invokeError('chat.activate-session', { sessionId: 'nope' })).toBe(
			'Query returned no rows',
		);
		expect(await invokeError('chat.send-prompt', { sessionId: 'nope', prompt: 'x' })).toBe(
			'session `nope` not found',
		);
		expect(await invokeError('chat.cancel-run', { sessionId: 'sess-stale' })).toBe(
			'cancel race: no active run for session',
		);
		expect(await invokeError('chat.start-session', {})).toBe(
			'invalid args: `workstreamId` must be a string',
		);
	});

	it('discards the session row when the bridge rejects the registration', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot({
			FAKE_BRIDGE_REJECT_START: 'START_SESSION_FAILED: provider handle could not boot',
		});
		expect(await invokeError('chat.start-session', { workstreamId: 'ws-1' })).toBe(
			'bridge unavailable: bridge protocol error: START_SESSION_FAILED: provider handle could not boot',
		);
		expect(scalar(test.db, 'SELECT COUNT(*) FROM agent_sessions')).toBe(0);
	});
});

describe('prompt round trips', () => {
	it('sends a prompt, persists user.message first, streams the reply, replays it, and reports open runs', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const sessionId = await invokeString('chat.start-session', {
			workstreamId: 'ws-1',
		});
		expect(await invokeBoolean('chat.workstream-has-open-run', { workstreamId: 'ws-1' })).toBe(
			false,
		);
		const runId = await invokeString('chat.send-prompt', {
			sessionId,
			prompt: 'Please fix the login bug',
			clientRequestId: 'req-1',
			contextFiles: ['src/app.ts', 'src/app.ts'],
			profile: { effort: 'high', mode: 'agent' },
		});
		expect(runId).toBe('run-req-1');
		expect(getSession(test.db, sessionId)?.displayName).toBe('Fix the login bug');
		await waitFor(() => getRun(test.db, runId)?.completedAt !== null);
		await service.runtime.settlePump();

		const rows = listEventRowsForSession(test.db, sessionId, 0);
		expect(rows.map((row) => row.kind)).toEqual([
			'session.state',
			'user.message',
			'run.started',
			'assistant.message',
			'usage.updated',
			'run.completed',
			'session.state',
		]);
		expect(rows[1]?.payload).toEqual({
			text: 'Please fix the login bug',
			clientRequestId: 'req-1',
			contextFiles: ['src/app.ts'],
			checkpointId: 'ckpt-run-req-1',
		});

		const replay = await invokeRecords('chat.list-events', { sessionId, afterSeq: 0 });
		expect(replay.map(eventType)).toEqual(rows.map((row) => row.kind));
		expect(replay[1]).toEqual({
			sessionId,
			runId,
			seq: 2,
			event: {
				type: 'user.message',
				runId,
				text: 'Please fix the login bug',
				clientRequestId: 'req-1',
				contextFiles: ['src/app.ts'],
				checkpointId: 'ckpt-run-req-1',
			},
		});
		expect(replay[2]?.['event']).toEqual({ type: 'run.started', runId, sessionId });
		expect(await invoke('chat.list-events', { sessionId, afterSeq: 7 })).toEqual([]);

		const live = envelopesOn(test.events);
		expect(live.find((envelope) => envelope.event['type'] === 'user.message')).toMatchObject({
			seq: 2,
			runId,
		});
		expect(
			live.filter((envelope) => envelope.ephemeral).map((envelope) => envelope.event['type']),
		).toEqual(['assistant.delta', 'usage.updated']);
		expect(getSession(test.db, sessionId)?.status).toBe('completed');
	});

	it('refuses a second prompt while a run is open, then cancels it as a durable barrier', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const sessionId = await invokeString('chat.start-session', {
			workstreamId: 'ws-1',
		});
		const runId = await invokeString('chat.send-prompt', { sessionId, prompt: 'HANG' });
		await waitFor(() => getSession(test.db, sessionId)?.status === 'running');
		expect(await invokeBoolean('chat.workstream-has-open-run', { workstreamId: 'ws-1' })).toBe(
			true,
		);
		expect(await invokeError('chat.send-prompt', { sessionId, prompt: 'again' })).toBe(
			`\`${sessionId}\` already has an active run`,
		);
		await invoke('chat.cancel-run', { sessionId });
		expect(getRun(test.db, runId)).toMatchObject({ error: 'cancelled' });
		expect(getSession(test.db, sessionId)?.status).toBe('idle');
		expect(await invokeBoolean('chat.workstream-has-open-run', { workstreamId: 'ws-1' })).toBe(
			false,
		);
	});

	it('runs a second chat of the workstream beside one that is still running', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const first = await invokeString('chat.start-session', { workstreamId: 'ws-1' });
		const second = await invokeString('chat.start-session', { workstreamId: 'ws-1' });
		const firstRun = await invokeString('chat.send-prompt', { sessionId: first, prompt: 'HANG' });
		await waitFor(() => getSession(test.db, first)?.status === 'running');

		const secondRun = await invokeString('chat.send-prompt', { sessionId: second, prompt: 'HANG' });
		await waitFor(() => getSession(test.db, second)?.status === 'running');

		expect(getRun(test.db, firstRun)).toMatchObject({ completedAt: null, error: null });
		await invoke('chat.cancel-run', { sessionId: second });
		expect(getRun(test.db, secondRun)).toMatchObject({ error: 'cancelled' });
		expect(getRun(test.db, firstRun)).toMatchObject({ completedAt: null, error: null });
		expect(getSession(test.db, first)?.status).toBe('running');
		await invoke('chat.cancel-run', { sessionId: first });
	});

	it('stops a prompt whose Stop arrived while its restore point was still being captured', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		let capturing = false;
		let finishCapture: () => void = () => undefined;
		const finished: RunFinishedInput[] = [];
		await boot(
			{},
			{
				hooks: {
					captureCheckpoint: (input) => {
						capturing = true;
						return new Promise((resolve) => {
							finishCapture = () => resolve(recordCheckpoint(input));
						});
					},
					onRunFinished: (input) => {
						finished.push(input);
						return Promise.resolve();
					},
				},
			},
		);
		const sessionId = await invokeString('chat.start-session', { workstreamId: 'ws-1' });
		const sent = invokeString('chat.send-prompt', {
			sessionId,
			prompt: 'HANG',
			clientRequestId: 'req-stop',
		});
		await waitFor(() => capturing);
		await invoke('chat.cancel-run', { sessionId, pendingRunId: 'run-req-stop' });
		finishCapture();

		expect(await sent).toBe('run-req-stop');
		expect(getRun(test.db, 'run-req-stop')).toMatchObject({ error: 'cancelled' });
		expect(getSession(test.db, sessionId)?.status).toBe('idle');
		expect(listEventRowsForSession(test.db, sessionId, 0).map((row) => row.kind)).toEqual([
			'session.state',
			'user.message',
			'run.failed',
		]);
		expect(await invokeBoolean('chat.workstream-has-open-run', { workstreamId: 'ws-1' })).toBe(
			false,
		);
		expect(finished).toEqual([
			{ sessionId, runId: 'run-req-stop', workstreamId: 'ws-1', reason: 'not-delivered' },
		]);
	});

	it('stops a prompt whose Stop reached the main process before the prompt did, and only that prompt', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const sessionId = await invokeString('chat.start-session', { workstreamId: 'ws-1' });

		await invoke('chat.cancel-run', { sessionId, pendingRunId: 'run-req-early' });
		expect(
			await invokeString('chat.send-prompt', {
				sessionId,
				prompt: 'HANG',
				clientRequestId: 'req-early',
			}),
		).toBe('run-req-early');
		expect(getRun(test.db, 'run-req-early')).toMatchObject({ error: 'cancelled' });

		const next = await invokeString('chat.send-prompt', {
			sessionId,
			prompt: 'hello',
			clientRequestId: 'req-next',
		});
		await waitFor(() => getRun(test.db, next)?.completedAt !== null);
		expect(getRun(test.db, next)).toMatchObject({ error: null, summary: 'done' });
	});

	it('resumes Claude at the end of the last turn the chat still shows', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const sessionId = await invokeString('chat.start-session', { workstreamId: 'ws-1' });
		const first = await invokeString('chat.send-prompt', { sessionId, prompt: 'one' });
		await waitFor(() => getRun(test.db, first)?.completedAt !== null);
		const second = await invokeString('chat.send-prompt', { sessionId, prompt: 'two' });
		await waitFor(() => getRun(test.db, second)?.completedAt !== null);

		expect(getRun(test.db, first)?.summary).toBe('done');
		expect(getRun(test.db, second)?.summary).toBe(`done after cursor-${first}`);
	});

	async function bootTrackingChanges(
		finished: RunFinishedInput[],
		afterFinished: () => Promise<void> = () => Promise.resolve(),
	): Promise<void> {
		await boot(
			{},
			{
				hooks: {
					captureCheckpoint: (input) => Promise.resolve(recordCheckpoint(input)),
					onRunFinished: (input) => {
						finished.push(input);
						return afterFinished();
					},
				},
			},
		);
	}

	it('captures terminal run changes for a cancelled run', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		const finished: RunFinishedInput[] = [];
		await bootTrackingChanges(finished);
		const sessionId = await invokeString('chat.start-session', {
			workstreamId: 'ws-1',
		});
		const runId = await invokeString('chat.send-prompt', { sessionId, prompt: 'HANG' });
		await waitFor(() => getSession(test.db, sessionId)?.status === 'running');
		await invoke('chat.cancel-run', { sessionId });
		await waitFor(() => finished.length > 0, 2_000, 'terminal capture for the cancelled run');
		expect(finished).toEqual([{ sessionId, runId, workstreamId: 'ws-1', reason: 'terminal' }]);
	});

	it('pauses a run the app quits out from under and captures its changes', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		const finished: RunFinishedInput[] = [];
		await bootTrackingChanges(finished);
		const sessionId = await invokeString('chat.start-session', {
			workstreamId: 'ws-1',
		});
		const runId = await invokeString('chat.send-prompt', { sessionId, prompt: 'HANG' });
		await waitFor(() => getSession(test.db, sessionId)?.status === 'running');

		await service.stop();
		expect(getRun(test.db, runId)).toMatchObject({ error: PAUSED_FOR_EXIT_ERROR });
		expect(finished).toEqual([{ sessionId, runId, workstreamId: 'ws-1', reason: 'terminal' }]);
		expect(await service.closeOpenRunsForExit()).toBe(0);
		expect(finished).toHaveLength(1);
	});

	it('continues a paused run on the next launch, from where it paused and with its profile', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const sessionId = await invokeString('chat.start-session', { workstreamId: 'ws-1' });
		const profile = { effort: 'high', mode: 'agent', access: 'full' };
		const runId = await invokeString('chat.send-prompt', { sessionId, prompt: 'HANG', profile });
		await waitFor(() => getSession(test.db, sessionId)?.status === 'running');

		await service.stop();
		expect(await invokeError('chat.send-prompt', { sessionId, prompt: 'hello' })).toContain(
			'malini is closing',
		);

		service = await startAgentService(
			{ ...test.context, commands: new CommandRegistry() },
			{
				processFactory: fake.supervisorConfig().processFactory,
				bridgeScriptPath: fake.scriptPath,
				spawnEnvironment: () => ({ PATH: process.env['PATH'] ?? '/usr/bin:/bin' }),
				leases: new AgentRunLeases(),
				hooks: { captureCheckpoint: (input) => Promise.resolve(recordCheckpoint(input)) },
				log: () => {},
			},
		);
		const latestRun = () =>
			get<{ prompt: string; summary: string | null; profile: string; automated: number }>(
				test.db,
				'SELECT prompt, summary, profile, automated FROM agent_runs WHERE session_id = ? ORDER BY rowid DESC LIMIT 1',
				sessionId,
			);
		await waitFor(() => latestRun()?.summary != null, 2_000, 'the paused run to continue');
		expect(latestRun()).toEqual({
			prompt: CONTINUE_AFTER_PAUSE_PROMPT,
			summary: `done after cursor-${runId}`,
			profile: JSON.stringify(profile),
			automated: 1,
		});
	});

	it('lets a terminal capture finish before stop returns, so quitting never closes the database under it', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		const finished: RunFinishedInput[] = [];
		let captureSettled = false;
		await bootTrackingChanges(finished, async () => {
			await new Promise((resolve) => setTimeout(resolve, 200));
			captureSettled = true;
		});
		const sessionId = await invokeString('chat.start-session', { workstreamId: 'ws-1' });
		await invokeString('chat.send-prompt', { sessionId, prompt: 'hello' });
		await waitFor(() => finished.length > 0, 2_000, 'terminal capture to start');

		await service.stop();

		expect(captureSettled).toBe(true);
	});

	it('closes the run when the bridge never takes the prompt', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot({ FAKE_BRIDGE_REJECT_PROMPT: 'NO_SESSION: no active session' });
		const sessionId = await invokeString('chat.start-session', {
			workstreamId: 'ws-1',
		});
		expect(
			await invokeError('chat.send-prompt', {
				sessionId,
				prompt: 'hello',
				clientRequestId: 'req-x',
			}),
		).toBe(
			'bridge unavailable: agent bridge send failed: bridge protocol error: NO_SESSION: no active session',
		);
		expect(scalar(test.db, 'SELECT COUNT(*) FROM agent_runs WHERE completed_at IS NULL')).toBe(0);
		expect(getRun(test.db, 'run-req-x')).toMatchObject({
			error: 'agent bridge send failed: bridge protocol error: NO_SESSION: no active session',
		});
		expect(getSession(test.db, sessionId)?.status).toBe('idle');
		const kinds = listEventRowsForSession(test.db, sessionId, 0).map((row) => row.kind);
		expect(kinds).toEqual(['session.state', 'user.message', 'run.failed']);
		expect(await invokeBoolean('chat.workstream-has-open-run', { workstreamId: 'ws-1' })).toBe(
			false,
		);
	});

	it('renames the workstream on the first prompt and emits repositories:workstream-renamed, then skips both on a second prompt', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const sessionId = await invokeString('chat.start-session', { workstreamId: 'ws-1' });
		const runId1 = await invokeString('chat.send-prompt', {
			sessionId,
			prompt: 'Fix the login bug',
			clientRequestId: 'req-rename-1',
		});
		await waitFor(() => getRun(test.db, runId1)?.completedAt !== null);
		expect(getWorkstream(test.db, 'ws-1')?.name).toBe('Fix the login bug');
		const renamedFrames = test.events.frames.filter(
			(f) => f.channel === REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL,
		);
		expect(renamedFrames).toHaveLength(1);
		expect(renamedFrames[0]?.payload).toEqual({ workstreamId: 'ws-1', name: 'Fix the login bug' });

		const runId2 = await invokeString('chat.send-prompt', {
			sessionId,
			prompt: 'Something else entirely',
			clientRequestId: 'req-rename-2',
		});
		await waitFor(() => getRun(test.db, runId2)?.completedAt !== null);
		expect(getWorkstream(test.db, 'ws-1')?.name).toBe('Fix the login bug');
		expect(
			test.events.frames.filter((f) => f.channel === REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL),
		).toHaveLength(1);
	});

	it('names nothing after a prompt malini wrote, then names the workstream and the chat from the first prompt the user writes', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const before = getWorkstream(test.db, 'ws-1')?.name;
		const sessionId = await invokeString('chat.start-session', { workstreamId: 'ws-1' });
		const chatBefore = getSession(test.db, sessionId)?.displayName;
		const automated = await invokeString('chat.send-prompt', {
			sessionId,
			prompt: 'Resolve the merge conflicts in this workstream.',
			clientRequestId: 'req-automated',
			automated: true,
		});
		await waitFor(() => getRun(test.db, automated)?.completedAt !== null);
		expect(getWorkstream(test.db, 'ws-1')?.name).toBe(before);
		expect(getSession(test.db, sessionId)?.displayName).toBe(chatBefore);
		expect(
			test.events.frames.filter((f) => f.channel === REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL),
		).toHaveLength(0);

		const written = await invokeString('chat.send-prompt', {
			sessionId,
			prompt: 'Fix the login bug',
			clientRequestId: 'req-written',
		});
		await waitFor(() => getRun(test.db, written)?.completedAt !== null);
		expect(getWorkstream(test.db, 'ws-1')?.name).toBe('Fix the login bug');
		expect(getSession(test.db, sessionId)?.displayName).toBe('Fix the login bug');
	});

	it('appends " 2" when another workstream of the same repository already holds the derived name', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		run(
			test.db,
			`INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			'ws-sibling',
			'project-ws-1',
			'Fix the login bug',
			`${test.appDataRoot}/workstreams/ws-sibling`,
			'malini/ws-sibling',
			'main',
			'active',
			new Date().toISOString(),
		);
		await boot();
		const sessionId = await invokeString('chat.start-session', { workstreamId: 'ws-1' });
		const runId = await invokeString('chat.send-prompt', {
			sessionId,
			prompt: 'Fix the login bug',
			clientRequestId: 'req-suffix',
		});
		await waitFor(() => getRun(test.db, runId)?.completedAt !== null);
		expect(getWorkstream(test.db, 'ws-1')?.name).toBe('Fix the login bug 2');
		const renamedFrames = test.events.frames.filter(
			(f) => f.channel === REPOSITORIES_WORKSTREAM_RENAMED_CHANNEL,
		);
		expect(renamedFrames).toHaveLength(1);
		expect(renamedFrames[0]?.payload).toEqual({
			workstreamId: 'ws-1',
			name: 'Fix the login bug 2',
		});
	});

	it('validates prompt context with the Rust messages', () => {
		expect(() => promptWithWorkstreamContext('p', ['../x'])).toThrow(
			'invalid prompt context: `../x` must be a normalized workstream-relative path',
		);
		expect(() => promptWithWorkstreamContext('p', ['/abs'])).toThrow('invalid prompt context');
		expect(() =>
			promptWithWorkstreamContext(
				'p',
				Array.from({ length: 21 }, (_, i) => `f${i}`),
			),
		).toThrow('at most 20 files can be attached');
		expect(promptWithWorkstreamContext('p', [' a/b.ts ', 'a/b.ts']).contextFiles).toEqual([
			'a/b.ts',
		]);
		const element = {
			url: 'https://x',
			domPath: 'div>span',
			rect: { top: 1, left: 2, width: 3, height: 4 },
			html: '<span></span>',
		};
		const result = promptWithElementReferences('p', [element, element]);
		expect(result.references).toHaveLength(1);
		expect(result.prompt).toContain('\\u003cspan\\u003e');
		expect(() => promptWithElementReferences('p', [{ ...element, html: '' }])).toThrow(
			'picked elements must carry a bounded URL, DOM path, rect, and markup',
		);
	});
});

describe('interactions', () => {
	let approvalPath = '';
	function permissionFor(path: string) {
		return {
			capability: 'read',
			resources: [{ kind: 'path', value: path, canonicalValue: path, boundary: 'external' }],
		};
	}

	async function pendingApproval(): Promise<{ sessionId: string; runId: string }> {
		approvalPath = externalReadPath();
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot({ FAKE_BRIDGE_APPROVAL_PATH: approvalPath });
		const sessionId = await invokeString('chat.start-session', {
			workstreamId: 'ws-1',
		});
		const runId = await invokeString('chat.send-prompt', { sessionId, prompt: 'APPROVAL' });
		await waitFor(
			() => getInteraction(test.db, 'approval', sessionId, runId, 'approval-1') !== null,
		);
		await service.runtime.settlePump();
		return { sessionId, runId };
	}

	it('decides an approval once, then answers the same decision idempotently', async () => {
		const { sessionId, runId } = await pendingApproval();
		expect(getSession(test.db, sessionId)?.status).toBe('waiting_for_approval');
		const permission = permissionFor(approvalPath);
		expect(
			await invokeError('chat.decide-approval', {
				sessionId,
				runId,
				approvalId: 'approval-1',
				decision: 'allow',
				scope: 'once',
			}),
		).toBe(
			'db invariant failed: permission payload for `approval-1` does not match the pending request',
		);
		const result = await invoke('chat.decide-approval', {
			sessionId,
			runId,
			approvalId: 'approval-1',
			decision: 'allow',
			scope: 'once',
			permission,
		});
		expect(result).toEqual({ decision: 'allow', scope: 'once', remembered: false });
		await waitFor(() => getRun(test.db, runId)?.completedAt !== null);
		expect(getRun(test.db, runId)?.summary).toBe('approved:allow:once');
		expect(getInteraction(test.db, 'approval', sessionId, runId, 'approval-1')).toMatchObject({
			state: 'resolved',
			decision: 'allow',
			scope: 'once',
			source: 'manual',
		});
		expect(
			await invoke('chat.decide-approval', {
				sessionId,
				runId,
				approvalId: 'approval-1',
				decision: 'allow',
				scope: 'once',
				permission,
			}),
		).toEqual({ decision: 'allow', scope: 'once', remembered: false });
		expect(
			await invokeError('chat.decide-approval', {
				sessionId,
				runId,
				approvalId: 'approval-1',
				decision: 'deny',
				scope: 'once',
				permission,
			}),
		).toBe('interaction `approval-1` was already resolved with a different response');
		expect(
			await invokeError('chat.decide-approval', {
				sessionId,
				runId,
				approvalId: 'approval-1',
				decision: 'maybe',
				scope: 'once',
			}),
		).toBe('approval decision must be `allow` or `deny`');
		expect(
			await invokeError('chat.decide-approval', {
				sessionId,
				runId,
				approvalId: 'gone',
				decision: 'allow',
				scope: 'once',
			}),
		).toBe(`pending approval \`gone\` was not found for session \`${sessionId}\` run \`${runId}\``);
	});

	it('remembers a session-scoped allow as a rule and reports its id', async () => {
		const { sessionId, runId } = await pendingApproval();
		const permission = permissionFor(approvalPath);
		expect(
			await invokeError('chat.decide-approval', {
				sessionId,
				runId,
				approvalId: 'approval-1',
				decision: 'allow',
				scope: 'session',
			}),
		).toBe('remembered approval requires the exact pending permission descriptor');
		const result = await invokeRecord('chat.decide-approval', {
			sessionId,
			runId,
			approvalId: 'approval-1',
			decision: 'allow',
			scope: 'session',
			permission,
		});
		expect(result).toMatchObject({ decision: 'allow', scope: 'session', remembered: true });
		const ruleId = result['ruleId'];
		expect(ruleId).toMatch(/^rule-/);
		expect(
			get<{ scope: string }>(
				test.db,
				'SELECT scope FROM agent_permission_rules WHERE id = ?',
				String(ruleId),
			),
		).toEqual({ scope: 'session' });
		await waitFor(() => getRun(test.db, runId)?.completedAt !== null);
	});

	it('answers a question after validating it against the stored request', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const sessionId = await invokeString('chat.start-session', {
			workstreamId: 'ws-1',
		});
		const runId = await invokeString('chat.send-prompt', { sessionId, prompt: 'QUESTION' });
		await waitFor(
			() => getInteraction(test.db, 'question', sessionId, runId, 'question-1') !== null,
		);
		await service.runtime.settlePump();
		expect(
			await invokeError('chat.answer-question', {
				sessionId,
				runId,
				questionId: 'question-1',
				answers: [{ questionId: 'q1', values: ['C'] }],
			}),
		).toBe('question `q1` contains an answer outside its options');
		expect(
			await invokeError('chat.answer-question', {
				sessionId,
				runId,
				questionId: 'question-1',
				answers: [{ questionId: 'q1', values: ['A', 'B'] }],
			}),
		).toBe('question `q1` accepts one answer');
		await invoke('chat.answer-question', {
			sessionId,
			runId,
			questionId: 'question-1',
			answers: [{ questionId: 'q1', values: ['B'] }],
		});
		await waitFor(() => getRun(test.db, runId)?.completedAt !== null);
		expect(getRun(test.db, runId)?.summary).toBe('answered:[{"questionId":"q1","values":["B"]}]');
		expect(getInteraction(test.db, 'question', sessionId, runId, 'question-1')).toMatchObject({
			state: 'resolved',
			decision: 'answered',
		});
		await invoke('chat.answer-question', {
			sessionId,
			runId,
			questionId: 'question-1',
			answers: [{ questionId: 'q1', values: ['B'] }],
		});
	});
});

describe('bridge commands', () => {
	it('resets a workstream, reads capabilities, refreshes MCP status, and restarts', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		await boot();
		const sessionId = await invokeString('chat.start-session', {
			workstreamId: 'ws-1',
		});
		const runId = await invokeString('chat.send-prompt', { sessionId, prompt: 'HANG' });
		await waitFor(() => getSession(test.db, sessionId)?.status === 'running');
		expect(await invokeNumber('chat.reset-workstream-runs', { workstreamId: 'ws-1' })).toBe(1);
		expect(getRun(test.db, runId)).toMatchObject({
			error: 'reset by user',
			summary: 'reset-by-user',
		});
		expect(getSession(test.db, sessionId)?.status).toBe('idle');
		expect(await invokeNumber('chat.reset-workstream-runs', { workstreamId: 'ws-1' })).toBe(0);
		expect(envelopesOn(test.events).at(-1)).toMatchObject({
			runId,
			event: { type: 'run.failed', error: 'reset by user' },
		});

		const capabilities = await invokeRecords('chat.agent-capabilities', {});
		expect(capabilities).toEqual([
			{
				state: 'ready',
				installed: true,
				authenticated: true,
				version: 'fixture-1.0.0',
				account: { email: 'fixture@example.com', plan: 'Claude Max' },
				models: [
					{
						id: 'default',
						label: 'Default',
						description: 'Fixture default',
						efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
					},
				],
				defaultModel: 'default',
				message: 'Ready',
			},
		]);
		const refreshed = await invokeRecords('chat.agent-capabilities', { refresh: true });
		expect(refreshed[0]).toMatchObject({ version: 'fixture-2.0.0' });

		await invoke('chat.activate-session', { sessionId });
		await invoke('chat.refresh-mcp-status', { sessionId });
		expect(await invokeError('chat.refresh-mcp-status', {})).toBe(
			'invalid args: `sessionId` must be a string',
		);

		const before = service.runtime.current();
		await before.kill();
		await invoke('chat.restart-agent');
		expect(service.runtime.current()).not.toBe(before);
		expect(service.health()).toMatchObject({ state: 'healthy' });
	}, 20_000);
});
