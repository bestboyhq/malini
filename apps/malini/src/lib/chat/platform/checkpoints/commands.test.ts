import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
}));

import type { MainContext } from '$main/context';
import {
	bindCheckpointToUserMessage,
	getCheckpointById,
	getUserBaselineForRun,
} from '../checkpoints.repository';
import { AgentRunLeases } from '../agent/lifecycle';
import { appendEvent } from '../events.repository';
import { CommandRegistry } from '$main/ipc/registry';
import { removeDir, tempDir } from '$main/git/fixtures.test-support';
import { CHECKPOINT_COMMAND_NAMES, installCheckpoints } from './commands';
import { SESSION_CHANGE_SCOPE_ERROR, type CheckpointService } from './service';
import {
	checkpointHarness,
	insertOpenRun,
	markRunCompleted,
	recordingBus,
	WORKSTREAM_ID,
	type CheckpointHarness,
} from './test-support';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

interface Harness extends CheckpointHarness {
	readonly commands: CommandRegistry;
	readonly events: ReturnType<typeof recordingBus>;
	readonly service: CheckpointService;
	invoke<T>(command: string, args: unknown): Promise<T>;
}

async function harness(): Promise<Harness> {
	const appDataRoot = await tempDir('malini-checkpoints-');
	cleanups.push(() => removeDir(appDataRoot));
	const base = await checkpointHarness(appDataRoot);
	const commands = new CommandRegistry();
	const events = recordingBus();
	const context: MainContext = {
		db: base.db,
		commands,
		events,
		appDataRoot,
		resourcesRoot: appDataRoot,
		isDev: true,
		appVersion: '0.0.0-test',
	};
	const service = installCheckpoints(context, {
		resolver: base.context.resolver,
		leases: new AgentRunLeases(),
	});
	async function invoke<T>(command: string, args: unknown): Promise<T>;
	async function invoke(command: string, args: unknown): Promise<unknown> {
		const response = await commands.invoke({ command, args });
		if (!response.ok) throw new Error(response.error);
		return response.value;
	}
	return { ...base, commands, events, service, invoke };
}

const SCOPE = { workstreamId: WORKSTREAM_ID };

async function runTurn(
	h: Harness,
	sessionId: string,
	runId: string,
	startedAt: string,
	edit: () => Promise<void>,
): Promise<string> {
	const checkpointId = await h.service.captureRunStart({
		workstreamId: WORKSTREAM_ID,
		sessionId,
		runId,
	});
	insertOpenRun(h.db, sessionId, runId, startedAt);
	const seq = appendEvent(h.db, sessionId, runId, 'user.message', { checkpointId });
	bindCheckpointToUserMessage(h.db, checkpointId, seq);
	await edit();
	markRunCompleted(h.db, runId);
	expect(await h.service.captureRunFinish(runId)).not.toBeNull();
	return checkpointId;
}

describe('installCheckpoints', () => {
	it('registers the 6 checkpoint commands and nothing else', async () => {
		const h = await harness();
		expect(h.commands.names()).toEqual([...CHECKPOINT_COMMAND_NAMES].sort());
	});

	it('captureRunStart takes the baseline then the checkpoint and reports a captured id', async () => {
		const h = await harness();
		await writeFile(join(h.repo, 'by-hand.txt'), 'human work\n');
		const checkpointId = await h.service.captureRunStart({
			workstreamId: WORKSTREAM_ID,
			sessionId: 'chat-a',
			runId: 'run-one',
		});
		expect(checkpointId).toMatch(/^checkpoint-\d+-\d+$/);
		expect(getCheckpointById(h.db, checkpointId)).toMatchObject({
			workstreamId: WORKSTREAM_ID,
			sessionId: 'chat-a',
			runId: 'run-one',
			userMessageSeq: null,
		});
		expect(getUserBaselineForRun(h.db, 'run-one')).toMatchObject({ runId: 'run-one' });
	});

	it('captureRunStart refuses to hand out a run without a checkpoint', async () => {
		const h = await harness();
		await expect(
			h.service.captureRunStart({
				workstreamId: 'workstream-missing',
				sessionId: 'chat-a',
				runId: 'run-lost',
			}),
		).rejects.toMatchObject({
			name: 'CheckpointError',
			message: 'Unknown workstream: workstream-missing',
		});
	});

	it('captureRunFinish captures once, emits chat:run-changes-captured, and is silent otherwise', async () => {
		const h = await harness();
		await runTurn(h, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z', () =>
			writeFile(join(h.repo, 'tracked.txt'), 'agent one\n'),
		);
		expect(h.events.frames).toEqual([
			{
				channel: 'chat:run-changes-captured',
				payload: { sessionId: 'chat-a', runId: 'run-one' },
			},
		]);

		insertOpenRun(h.db, 'chat-a', 'run-bare', '2026-07-22T00:02:00.000Z');
		markRunCompleted(h.db, 'run-bare');
		expect(await h.service.captureRunFinish('run-bare')).toBeNull();
		expect(await h.service.captureRunFinish('run-unknown')).toBeNull();
		expect(h.events.frames).toHaveLength(1);
	});

	it('round-trips the change reads through the registry with the renderer argument keys', async () => {
		const h = await harness();
		await runTurn(h, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z', () =>
			writeFile(join(h.repo, 'tracked.txt'), 'agent one\n'),
		);
		await runTurn(h, 'chat-a', 'run-two', '2026-07-22T00:02:00.000Z', () =>
			writeFile(join(h.repo, 'agent.txt'), 'agent two\n'),
		);

		const changes = await h.invoke<{
			sessionId: string;
			runs: Array<{ runId: string }>;
			files: Array<{ path: string; runIds: string[] }>;
			beforeCommit: string | null;
			afterCommit: string | null;
			capturedAt: string | null;
		}>('chat.session-changes', { ...SCOPE, sessionId: 'chat-a' });
		expect(changes.sessionId).toBe('chat-a');
		expect(changes.runs.map((run) => run.runId)).toEqual(['run-one', 'run-two']);
		expect(changes.files).toEqual([
			{ path: 'agent.txt', additions: 1, deletions: 0, isBinary: false, runIds: ['run-two'] },
			{ path: 'tracked.txt', additions: 1, deletions: 1, isBinary: false, runIds: ['run-one'] },
		]);
		expect(changes.beforeCommit).toMatch(/^[0-9a-f]{40}$/);
		expect(changes.afterCommit).toMatch(/^[0-9a-f]{40}$/);
		expect(changes.capturedAt).toEqual(expect.any(String));

		const sessionPatch = await h.invoke<{ sessionId: string; patch: string }>(
			'chat.session-change-patch',
			{ ...SCOPE, sessionId: 'chat-a', path: 'agent.txt' },
		);
		expect(sessionPatch).toEqual({
			sessionId: 'chat-a',
			beforeCommit: changes.beforeCommit,
			afterCommit: changes.afterCommit,
			patch: expect.stringContaining('+agent two'),
			turns: [],
		});

		const runPatch = await h.invoke<{ runId: string; patch: string }>('chat.run-change-patch', {
			...SCOPE,
			sessionId: 'chat-a',
			runId: 'run-one',
		});
		expect(runPatch).toEqual({
			runId: 'run-one',
			beforeCommit: changes.beforeCommit,
			afterCommit: expect.stringMatching(/^[0-9a-f]{40}$/),
			patch: expect.stringContaining('+agent one'),
		});
		const pathPatch = await h.invoke<{ patch: string }>('chat.run-change-patch', {
			...SCOPE,
			sessionId: 'chat-a',
			runId: 'run-one',
			path: 'tracked.txt',
		});
		expect(pathPatch.patch).toContain('+agent one');

		await expect(
			h.invoke('chat.run-change-patch', {
				...SCOPE,
				sessionId: 'chat-a',
				runId: 'run-one',
				path: 'agent.txt',
			}),
		).rejects.toThrow('file `agent.txt` is not attributed to run `run-one` in session `chat-a`');
		await expect(
			h.invoke('chat.session-change-patch', {
				...SCOPE,
				sessionId: 'chat-a',
				path: 'nope.txt',
			}),
		).rejects.toThrow('file `nope.txt` is not part of the changes for session `chat-a`');
	});

	it('every change read fails closed outside the session scope', async () => {
		const h = await harness();
		const foreign = { workstreamId: 'workstream-other' };
		await expect(
			h.invoke('chat.session-changes', { ...foreign, sessionId: 'chat-a' }),
		).rejects.toThrow(SESSION_CHANGE_SCOPE_ERROR);
		await expect(
			h.invoke('chat.session-change-patch', {
				...foreign,
				sessionId: 'chat-a',
				path: 'x',
			}),
		).rejects.toThrow(SESSION_CHANGE_SCOPE_ERROR);
		await expect(
			h.invoke('chat.run-change-patch', { ...foreign, sessionId: 'chat-a', runId: 'r' }),
		).rejects.toThrow(SESSION_CHANGE_SCOPE_ERROR);
		await expect(
			h.invoke('chat.session-changes', { ...SCOPE, sessionId: 'chat-b' }),
		).resolves.toMatchObject({ sessionId: 'chat-b', runs: [], files: [] });
	});

	it('rejects a missing argument with a plain string', async () => {
		const h = await harness();
		const response = await h.commands.invoke({
			command: 'chat.session-changes',
			args: { ...SCOPE },
		});
		expect(response).toEqual({ ok: false, error: 'invalid args: `sessionId` must be a string' });
		await expect(
			h.invoke('chat.restore-checkpoint', { workstreamId: WORKSTREAM_ID }),
		).rejects.toThrow('invalid args: `checkpointId` must be a string');
	});

	it('restores a checkpoint through the registry and emits chat:checkpoint-restored', async () => {
		const h = await harness();
		const first = await runTurn(h, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z', () =>
			writeFile(join(h.repo, 'tracked.txt'), 'agent one\n'),
		);
		await runTurn(h, 'chat-a', 'run-two', '2026-07-22T00:02:00.000Z', () =>
			writeFile(join(h.repo, 'agent.txt'), 'agent two\n'),
		);
		h.events.frames.length = 0;

		expect(h.service.workstreamHasOpenRun(WORKSTREAM_ID)).toBe(false);
		const result = await h.invoke('chat.restore-checkpoint', {
			workstreamId: WORKSTREAM_ID,
			checkpointId: first,
		});
		expect(result).toMatchObject({
			sessionId: 'chat-a',
			removedRunCount: 2,
			restoreSeq: expect.any(Number),
		});
		expect(h.events.frames.map((frame) => frame.channel)).toEqual([
			'chat:agent-event',
			'chat:agent-event',
			'chat:checkpoint-restored',
		]);
		expect(
			h.events.frames
				.filter((frame) => frame.channel === 'chat:agent-event')
				.map((frame) => {
					const payload = frame.payload as { event?: { type?: string } };
					return payload.event?.type;
				}),
		).toEqual(['checkpoint.restored', 'turn.superseded']);
		expect(h.events.frames.at(-1)).toEqual({
			channel: 'chat:checkpoint-restored',
			payload: { workstreamId: WORKSTREAM_ID, checkpointId: first, sessionId: 'chat-a' },
		});
		expect(await h.invoke('chat.session-changes', { ...SCOPE, sessionId: 'chat-a' })).toMatchObject(
			{ runs: [], files: [] },
		);
	});

	it('refuses a restore while any run in the workstream is open and says so', async () => {
		const h = await harness();
		const checkpointId = await runTurn(h, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z', () =>
			writeFile(join(h.repo, 'tracked.txt'), 'agent one\n'),
		);
		insertOpenRun(h.db, 'chat-b', 'run-sibling', '2026-07-22T00:02:00.000Z');
		expect(h.service.workstreamHasOpenRun(WORKSTREAM_ID)).toBe(true);
		await expect(
			h.invoke('chat.restore-checkpoint', { workstreamId: WORKSTREAM_ID, checkpointId }),
		).rejects.toThrow('wait for the active run to finish before restoring a checkpoint');
		markRunCompleted(h.db, 'run-sibling');
		await expect(
			h.invoke('chat.restore-checkpoint', {
				workstreamId: WORKSTREAM_ID,
				checkpointId: 'checkpoint-missing',
			}),
		).rejects.toThrow('checkpoint `checkpoint-missing` not found');
		expect(h.events.frames.some((frame) => frame.channel === 'chat:checkpoint-restored')).toBe(
			false,
		);
	});

	it('the service reads enforce the same scope as the commands', async () => {
		const h = await harness();
		await expect(
			h.service.getSessionChanges({
				...SCOPE,
				workstreamId: 'workstream-other',
				sessionId: 'chat-a',
			}),
		).rejects.toThrow(SESSION_CHANGE_SCOPE_ERROR);
		await expect(
			h.service.getRunChangePatch({ ...SCOPE, sessionId: 'chat-a', runId: 'run-none' }),
		).rejects.toThrow('run change `run-none` was not found in session `chat-a`');
		insertOpenRun(h.db, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z');
		const checkpointId = await h.service.captureRunStart({
			workstreamId: WORKSTREAM_ID,
			sessionId: 'chat-a',
			runId: 'run-one',
		});
		bindCheckpointToUserMessage(h.db, checkpointId, 1);
		markRunCompleted(h.db, 'run-one');
		expect(h.service.workstreamHasOpenRun(WORKSTREAM_ID)).toBe(false);
		await expect(h.service.restoreCheckpoint(WORKSTREAM_ID, checkpointId)).resolves.toMatchObject({
			sessionId: 'chat-a',
			removedRunCount: 0,
			restoreSeq: expect.any(Number),
		});
	});
});
