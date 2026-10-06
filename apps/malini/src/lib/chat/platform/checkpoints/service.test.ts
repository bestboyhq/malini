import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	bindCheckpointToUserMessage,
	getCheckpointForRun,
	getUserBaselineForRun,
	listWorkstreamSnapshotRefs,
} from '../checkpoints.repository';
import { sessionChanges, terminalRunsWithoutChanges } from '../changes.repository';
import { appendEvent, listEventRowsForSession } from '../events.repository';
import { isRecord, run } from '$main/db/rows';
import { MIGRATION_0033_FORKED_TURN_CHECKPOINTS } from '$main/db/migrations';
import { workstreamHasOpenRun } from '../runs.repository';
import { insertSession } from '../sessions.repository';
import { upsertWorkstream } from '$shared/repositories/repositories.platform';
import { removeDir, tempDir } from '$main/git/fixtures.test-support';
import {
	diffWorktreeSnapshotPatch,
	diffWorktreeSnapshots,
	SALVAGE_REF_NAMESPACE,
	USER_BASELINE_REF_NAMESPACE,
	worktreeSnapshotTree,
} from '$main/git/snapshots';
import { deleteWorkstreamSnapshotRefs } from '$shared/repositories/repositories.platform';
import {
	captureCheckpointForRun,
	captureRunChangesForTerminal,
	captureUserBaselineForRun,
	CheckpointError,
	DIFFS_NEED_THE_FOLDER,
	ensureAgentSessionChangeScope,
	recoverRunIntervals,
	restoreCheckpoint,
	runChangePatchForWorkstream,
	SESSION_CHANGE_SCOPE_ERROR,
	sessionChangePatchForWorkstream,
	sessionChangesForWorkstream,
	type CheckpointContext,
} from './service';
import {
	checkpointHarness,
	insertOpenRun,
	listRefs,
	markRunCompleted,
	PROJECT_ID,
	realGit,
	refExists,
	treeFiles,
	WORKSTREAM_ID,
} from './test-support';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

async function harness() {
	const appDataRoot = await tempDir('malini-checkpoints-');
	cleanups.push(() => removeDir(appDataRoot));
	return checkpointHarness(appDataRoot);
}

async function completedRun(
	context: CheckpointContext,
	sessionId: string,
	runId: string,
	startedAt: string,
	edit: () => Promise<void>,
) {
	insertOpenRun(context.db, sessionId, runId, startedAt);
	const checkpoint = await captureCheckpointForRun(context, WORKSTREAM_ID, sessionId, runId);
	await edit();
	markRunCompleted(context.db, runId);
	const change = await captureRunChangesForTerminal(context, runId);
	if (!change) throw new Error(`run ${runId} captured nothing`);
	return { checkpoint, change };
}

describe('session change scope', () => {
	it('changed-file reads require the session to belong to the requested workstream', async () => {
		const { db, repo } = await harness();
		upsertWorkstream(db, {
			id: 'workstream-other',
			projectId: PROJECT_ID,
			name: 'Other workstream',
			path: repo,
			branch: 'codex/other',
			baseBranch: 'main',
			status: 'active',
			createdAt: '2026-07-22T00:01:00.000Z',
		});
		insertSession(db, {
			id: 'chat-other',
			workstreamId: 'workstream-other',
			model: null,
			providerSessionId: null,
			status: 'running',
			startedAt: '2026-07-22T00:01:00.000Z',
		});

		expect(() => ensureAgentSessionChangeScope(db, WORKSTREAM_ID, 'chat-a')).not.toThrow();
		expect(() => ensureAgentSessionChangeScope(db, 'workstream-other', 'chat-other')).not.toThrow();
		for (const [workstreamId, sessionId] of [
			['workstream-other', 'chat-a'],
			[WORKSTREAM_ID, 'chat-other'],
			[WORKSTREAM_ID, 'missing-chat'],
			['missing-workstream', 'chat-a'],
		] as const) {
			expect(() => ensureAgentSessionChangeScope(db, workstreamId, sessionId)).toThrow(
				SESSION_CHANGE_SCOPE_ERROR,
			);
		}
	});
});

describe('run change capture', () => {
	it('terminal run changes are session exact with shared paths and preexisting dirt', async () => {
		const { db, repo, context } = await harness();
		await writeFile(join(repo, 'manual-preexisting.txt'), 'clean\n');
		await realGit(repo, ['add', 'manual-preexisting.txt']);
		await realGit(repo, ['commit', '-q', '-m', 'manual base']);
		await writeFile(join(repo, 'manual-preexisting.txt'), 'unrelated user dirt\n');

		const { change: changeA } = await completedRun(
			context,
			'chat-a',
			'run-a',
			'2026-07-22T00:00:01.000Z',
			() => writeFile(join(repo, 'tracked.txt'), 'from chat A\n'),
		);
		const { change: changeB } = await completedRun(
			context,
			'chat-b',
			'run-b',
			'2026-07-22T00:02:00.000Z',
			() => writeFile(join(repo, 'tracked.txt'), 'from chat B\n'),
		);
		const { change: changeA2 } = await completedRun(
			context,
			'chat-a',
			'run-a2',
			'2026-07-22T00:03:00.000Z',
			() => writeFile(join(repo, 'tracked.txt'), 'from chat A again\n'),
		);

		const patchOf = (change: typeof changeA) =>
			diffWorktreeSnapshotPatch(repo, change.beforeCommit, change.afterCommit, 'tracked.txt');
		const patchA = await patchOf(changeA);
		const patchB = await patchOf(changeB);
		const patchA2 = await patchOf(changeA2);

		expect(changeA.files).toEqual([
			{ path: 'tracked.txt', additions: 1, deletions: 1, isBinary: false },
		]);
		expect(changeB.files[0]?.path).toBe('tracked.txt');
		expect(patchA).toContain('+from chat A');
		expect(patchA).not.toContain('from chat B');
		expect(patchB).toContain('-from chat A');
		expect(patchB).toContain('+from chat B');
		expect(patchA2).toContain('-from chat B');
		expect(patchA2).toContain('+from chat A again');
		for (const change of [changeA, changeB, changeA2]) {
			expect(change.files.every((file) => file.path !== 'manual-preexisting.txt')).toBe(true);
			expect(await realGit(repo, ['show-ref', '--verify', change.afterRef])).toContain(
				change.afterCommit,
			);
		}

		const chatA = sessionChanges(db, 'chat-a');
		const chatB = sessionChanges(db, 'chat-b');
		expect(chatA.runs.map((run) => run.runId)).toEqual(['run-a', 'run-a2']);
		expect(chatA.files[0]?.runIds).toEqual(['run-a', 'run-a2']);
		expect([chatA.files[0]?.additions, chatA.files[0]?.deletions]).toEqual([2, 2]);
		expect(chatB.files[0]?.runIds).toEqual(['run-b']);
		expect(chatA.files[0]?.path).toBe(chatB.files[0]?.path);
		expect(await patchOf(changeA)).toBe(patchA);

		const refs = listWorkstreamSnapshotRefs(db, WORKSTREAM_ID);
		expect(refs.checkpointRefs).toHaveLength(3);
		expect(refs.runChangeRefs).toHaveLength(3);
		expect(refs.userBaselineRefs).toEqual([]);
		await deleteWorkstreamSnapshotRefs(db, repo, WORKSTREAM_ID);
		for (const ref of [...refs.checkpointRefs, ...refs.runChangeRefs]) {
			expect(await refExists(repo, ref)).toBe(false);
		}
	});

	it('a capture is idempotent on the run', async () => {
		const { repo, context } = await harness();
		const { change } = await completedRun(
			context,
			'chat-a',
			'run-once',
			'2026-07-22T00:00:01.000Z',
			() => writeFile(join(repo, 'tracked.txt'), 'once\n'),
		);
		await writeFile(join(repo, 'tracked.txt'), 'later\n');
		expect(await captureRunChangesForTerminal(context, 'run-once')).toEqual(change);
		expect(await listRefs(repo, 'refs/malini/run-changes/')).toHaveLength(1);
	});

	it('a terminal run that lost its end snapshot is closed by the next run start', async () => {
		const { db, repo, context } = await harness();
		insertOpenRun(db, 'chat-a', 'run-crashed', '2026-07-22T00:00:01.000Z');
		await captureCheckpointForRun(context, WORKSTREAM_ID, 'chat-a', 'run-crashed');
		await writeFile(join(repo, 'crashed.txt'), 'written before the app died\n');
		markRunCompleted(db, 'run-crashed');
		insertOpenRun(db, 'chat-b', 'run-next', '2026-07-22T00:05:00.000Z');
		await captureCheckpointForRun(context, WORKSTREAM_ID, 'chat-b', 'run-next');
		await writeFile(join(repo, 'later.txt'), 'written by the next run\n');

		expect(terminalRunsWithoutChanges(db, 'chat-a')).toEqual(['run-crashed']);
		await recoverRunIntervals(context, WORKSTREAM_ID, ['run-crashed']);
		expect(terminalRunsWithoutChanges(db, 'chat-a')).toEqual([]);
		const changes = await sessionChangesForWorkstream(context, WORKSTREAM_ID, 'chat-a');
		expect(changes.files.map((file) => file.path)).toEqual(['crashed.txt']);
		expect(changes.files[0]?.runIds).toEqual(['run-crashed']);
	});

	it('legacy runs without a checkpoint are tracked between the snapshots around them', async () => {
		const { db, repo, context } = await harness();
		await realGit(repo, ['update-ref', 'refs/heads/main', 'HEAD']);
		insertOpenRun(db, 'chat-a', 'run-legacy-one', '2026-07-22T00:00:01.000Z');
		await writeFile(join(repo, 'legacy-one.txt'), 'first legacy run\n');
		markRunCompleted(db, 'run-legacy-one');
		await completedRun(context, 'chat-a', 'run-tracked', '2026-07-22T00:02:00.000Z', () =>
			writeFile(join(repo, 'tracked.txt'), 'tracked run\n'),
		);
		insertOpenRun(db, 'chat-a', 'run-legacy-two', '2026-07-22T00:04:00.000Z');
		await writeFile(join(repo, 'legacy-two.txt'), 'second legacy run\n');
		markRunCompleted(db, 'run-legacy-two');

		await recoverRunIntervals(context, WORKSTREAM_ID, terminalRunsWithoutChanges(db, 'chat-a'));
		expect(terminalRunsWithoutChanges(db, 'chat-a')).toEqual([]);
		expect(getCheckpointForRun(db, 'run-legacy-one')?.userMessageSeq).toBeNull();
		const changes = await sessionChangesForWorkstream(context, WORKSTREAM_ID, 'chat-a');
		expect(changes.files.map((file) => [file.path, file.runIds])).toEqual([
			['legacy-one.txt', ['run-legacy-one']],
			['legacy-two.txt', ['run-legacy-two']],
			['tracked.txt', ['run-tracked']],
		]);
	});

	it('a capture against a workstream with no checkout fails as git, in what the resolver said', async () => {
		const { db, context } = await harness();
		insertOpenRun(db, 'chat-a', 'run-x', '2026-07-22T00:00:01.000Z');
		await expect(
			captureCheckpointForRun(context, 'workstream-missing', 'chat-a', 'run-x'),
		).rejects.toMatchObject({
			name: 'CheckpointError',
			kind: 'git',
			message: 'Unknown workstream: workstream-missing',
		});
	});
});

describe('session composition', () => {
	it('session changes are one net diff and hide add then revert', async () => {
		const { repo, context } = await harness();
		await completedRun(context, 'chat-a', 'run-add', '2026-07-22T00:00:01.000Z', () =>
			writeFile(join(repo, 'temporary.ts'), 'export const transient = true;\n'),
		);
		await completedRun(context, 'chat-a', 'run-revert', '2026-07-22T00:02:00.000Z', () =>
			rm(join(repo, 'temporary.ts')),
		);
		const changes = await sessionChangesForWorkstream(context, WORKSTREAM_ID, 'chat-a');
		expect(changes.runs).toHaveLength(2);
		expect(changes.files).toEqual([]);
	});

	it('composition excludes paths changed only between agent runs', async () => {
		const { repo, context } = await harness();
		const { checkpoint: first } = await completedRun(
			context,
			'chat-a',
			'run-one',
			'2026-07-22T00:00:01.000Z',
			() => writeFile(join(repo, 'tracked.txt'), 'agent run one\n'),
		);
		await writeFile(join(repo, 'human-only.txt'), 'written between runs\n');
		const { change: latest } = await completedRun(
			context,
			'chat-a',
			'run-two',
			'2026-07-22T00:02:00.000Z',
			() => writeFile(join(repo, 'agent-only.txt'), 'written by run two\n'),
		);

		const endpoint = await diffWorktreeSnapshots(repo, first.gitCommit, latest.afterCommit);
		expect(endpoint.files.some((file) => file.path === 'human-only.txt')).toBe(true);

		const changes = await sessionChangesForWorkstream(context, WORKSTREAM_ID, 'chat-a');
		expect(changes.files.map((file) => file.path)).toEqual(['agent-only.txt', 'tracked.txt']);
		expect(changes.files.every((file) => file.runIds.length > 0)).toBe(true);
		for (const file of changes.files) {
			const patch = await sessionChangePatchForWorkstream(
				context,
				WORKSTREAM_ID,
				'chat-a',
				file.path,
			);
			expect(patch.beforeCommit).toBe(changes.beforeCommit);
			expect(patch.afterCommit).toBe(changes.afterCommit);
			expect(patch.patch).not.toContain('written between runs');
		}
		await expect(
			sessionChangePatchForWorkstream(context, WORKSTREAM_ID, 'chat-a', 'human-only.txt'),
		).rejects.toThrow('file `human-only.txt` is not part of the changes for session `chat-a`');
	});

	it('a same-path inter-run human edit is not attributed to the agent', async () => {
		const { repo, context } = await harness();
		await completedRun(context, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z', () =>
			writeFile(join(repo, 'tracked.txt'), 'agent one\n'),
		);
		await writeFile(join(repo, 'tracked.txt'), 'human prefix\nagent one\n');
		await completedRun(context, 'chat-a', 'run-two', '2026-07-22T00:02:00.000Z', () =>
			writeFile(join(repo, 'tracked.txt'), 'human prefix\nagent one\nagent two\n'),
		);

		const changes = await sessionChangesForWorkstream(context, WORKSTREAM_ID, 'chat-a');
		expect(changes.files).toHaveLength(1);
		expect(changes.files[0]?.runIds).toEqual(['run-one', 'run-two']);
		const patch = await sessionChangePatchForWorkstream(
			context,
			WORKSTREAM_ID,
			'chat-a',
			'tracked.txt',
		);
		expect(patch.patch).toContain('+agent one');
		expect(patch.patch).toContain('+agent two');
		expect(patch.patch).not.toContain('human prefix');
	});

	it('a file someone else rewrote between two runs still lists both runs and only their edits', async () => {
		const { repo, context } = await harness();
		await writeFile(join(repo, 'other.txt'), 'line one\nline two\n');
		await completedRun(context, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z', () =>
			writeFile(join(repo, 'tracked.txt'), 'agent one\n'),
		);
		await writeFile(join(repo, 'tracked.txt'), 'human rewrite\n');
		await writeFile(join(repo, 'other.txt'), 'line one\nhuman two\n');
		await completedRun(context, 'chat-a', 'run-two', '2026-07-22T00:02:00.000Z', async () => {
			await writeFile(join(repo, 'tracked.txt'), 'agent two\n');
			await writeFile(join(repo, 'other.txt'), 'line one\nhuman two\nagent three\n');
		});

		const changes = await sessionChangesForWorkstream(context, WORKSTREAM_ID, 'chat-a');
		expect(changes.files).toEqual([
			{ path: 'other.txt', additions: 1, deletions: 0, isBinary: false, runIds: ['run-two'] },
			{
				path: 'tracked.txt',
				additions: 2,
				deletions: 2,
				isBinary: false,
				runIds: ['run-one', 'run-two'],
			},
		]);
		const tracked = await sessionChangePatchForWorkstream(
			context,
			WORKSTREAM_ID,
			'chat-a',
			'tracked.txt',
		);
		expect(tracked.beforeCommit).toBe(changes.beforeCommit);
		expect(tracked.afterCommit).toBe(changes.afterCommit);
		expect(tracked.patch).toBe('');
		expect(
			tracked.turns.map(({ runId, turn, title, additions, deletions }) => ({
				runId,
				turn,
				title,
				additions,
				deletions,
			})),
		).toEqual([
			{ runId: 'run-one', turn: 1, title: 'Prompt for chat-a', additions: 1, deletions: 1 },
			{ runId: 'run-two', turn: 2, title: 'Prompt for chat-a', additions: 1, deletions: 1 },
		]);
		expect(tracked.turns[0]?.patch).toContain('-base\n+agent one');
		expect(tracked.turns[1]?.patch).toContain('-human rewrite\n+agent two');
		expect(tracked.turns.map((turn) => turn.patch).join('')).not.toContain('+human rewrite');
		const other = await sessionChangePatchForWorkstream(
			context,
			WORKSTREAM_ID,
			'chat-a',
			'other.txt',
		);
		expect(other.turns).toEqual([]);
		expect(other.patch).toContain('+agent three');
		expect(other.patch).not.toContain('+human two');
	});

	it('net counts and the path patch compose captured run intervals', async () => {
		const { repo, context } = await harness();
		const { checkpoint: first } = await completedRun(
			context,
			'chat-a',
			'run-one',
			'2026-07-22T00:00:01.000Z',
			() => writeFile(join(repo, 'tracked.txt'), 'const one = 1;\nconst two = 2;\n'),
		);
		const { change: latest } = await completedRun(
			context,
			'chat-a',
			'run-two',
			'2026-07-22T00:02:00.000Z',
			async () => {
				await writeFile(
					join(repo, 'tracked.txt'),
					'const one = 1;\nconst finalValue = 3;\nconst three = 3;\n',
				);
				await writeFile(join(repo, 'notes.txt'), 'note\n');
			},
		);

		const changes = await sessionChangesForWorkstream(context, WORKSTREAM_ID, 'chat-a');
		expect(changes.beforeCommit).toBe(first.gitCommit);
		expect(changes.afterCommit).toBe(latest.afterCommit);
		expect(changes.files).toEqual([
			{ path: 'notes.txt', additions: 1, deletions: 0, isBinary: false, runIds: ['run-two'] },
			{
				path: 'tracked.txt',
				additions: 3,
				deletions: 1,
				isBinary: false,
				runIds: ['run-one', 'run-two'],
			},
		]);
		expect(
			(await sessionChangePatchForWorkstream(context, WORKSTREAM_ID, 'chat-a', 'notes.txt')).patch,
		).toContain('+note');

		const patch = await sessionChangePatchForWorkstream(
			context,
			WORKSTREAM_ID,
			'chat-a',
			'tracked.txt',
		);
		expect(patch).toEqual({
			sessionId: 'chat-a',
			beforeCommit: changes.beforeCommit,
			afterCommit: changes.afterCommit,
			patch: expect.stringContaining('+const finalValue = 3;'),
			turns: [],
		});
		await expect(
			sessionChangePatchForWorkstream(context, WORKSTREAM_ID, 'chat-a', 'not-attributed.ts'),
		).rejects.toThrow('not part of the changes');
	});

	it('the list keeps every run interval when the checkout is gone', async () => {
		const { repo, context } = await harness();
		await completedRun(context, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z', () =>
			writeFile(join(repo, 'tracked.txt'), 'agent one\n'),
		);
		await removeDir(repo);
		const changes = await sessionChangesForWorkstream(context, WORKSTREAM_ID, 'chat-a');
		expect(changes.runs).toHaveLength(1);
		expect(changes.files).toEqual([
			{ path: 'tracked.txt', additions: 1, deletions: 1, isBinary: false, runIds: ['run-one'] },
		]);
		await expect(
			sessionChangePatchForWorkstream(context, WORKSTREAM_ID, 'chat-a', 'tracked.txt'),
		).rejects.toThrow(DIFFS_NEED_THE_FOLDER);
	});
});

describe('run change patch', () => {
	it('opens a whole run or one attributed path and refuses anything else', async () => {
		const { repo, context } = await harness();
		const { change } = await completedRun(
			context,
			'chat-a',
			'run-one',
			'2026-07-22T00:00:01.000Z',
			async () => {
				await writeFile(join(repo, 'tracked.txt'), 'agent one\n');
				await writeFile(join(repo, 'new.txt'), 'new\n');
			},
		);
		const whole = await runChangePatchForWorkstream(
			context,
			WORKSTREAM_ID,
			'chat-a',
			'run-one',
			null,
		);
		expect(whole).toEqual({
			runId: 'run-one',
			beforeCommit: change.beforeCommit,
			afterCommit: change.afterCommit,
			patch: expect.stringContaining('+agent one'),
		});
		expect(whole.patch).toContain('new.txt');
		const one = await runChangePatchForWorkstream(
			context,
			WORKSTREAM_ID,
			'chat-a',
			'run-one',
			'new.txt',
		);
		expect(one.patch).toContain('+new');
		expect(one.patch).not.toContain('agent one');

		await expect(
			runChangePatchForWorkstream(context, WORKSTREAM_ID, 'chat-a', 'run-one', 'absent.txt'),
		).rejects.toThrow('file `absent.txt` is not attributed to run `run-one` in session `chat-a`');
		await expect(
			runChangePatchForWorkstream(context, WORKSTREAM_ID, 'chat-b', 'run-one', null),
		).rejects.toThrow('run change `run-one` was not found in session `chat-b`');
		await expect(
			runChangePatchForWorkstream(context, 'workstream-other', 'chat-a', 'run-one', null),
		).rejects.toThrow('run change `run-one` has no matching checkpoint');
	});
});

describe('user baselines', () => {
	it('a user baseline records only work the agent did not put there', async () => {
		const { db, repo, context } = await harness();

		insertOpenRun(db, 'chat-a', 'run-clean', '2026-07-22T00:00:01.000Z');
		expect(
			await captureUserBaselineForRun(context, WORKSTREAM_ID, 'chat-a', 'run-clean'),
		).toBeNull();

		await writeFile(join(repo, 'tracked.txt'), 'edited by hand\n');
		await writeFile(join(repo, 'by-hand.txt'), 'untracked human work\n');
		insertOpenRun(db, 'chat-a', 'run-one', '2026-07-22T00:01:00.000Z');
		const baseline = await captureUserBaselineForRun(context, WORKSTREAM_ID, 'chat-a', 'run-one');
		if (!baseline) throw new Error('uncommitted human work is recorded');
		expect(baseline.runId).toBe('run-one');
		expect(baseline.gitRef).toBe(`${USER_BASELINE_REF_NAMESPACE}${WORKSTREAM_ID}/${baseline.id}`);
		expect(await realGit(repo, ['show-ref', '--verify', baseline.gitRef])).toContain(
			baseline.gitCommit,
		);
		expect(await treeFiles(repo, baseline.gitCommit)).toContain('by-hand.txt');
		expect(getUserBaselineForRun(db, 'run-one')).toEqual(baseline);

		await captureCheckpointForRun(context, WORKSTREAM_ID, 'chat-a', 'run-one');
		await writeFile(join(repo, 'tracked.txt'), 'rewritten by the agent\n');
		markRunCompleted(db, 'run-one');
		expect(await captureRunChangesForTerminal(context, 'run-one')).not.toBeNull();

		insertOpenRun(db, 'chat-a', 'run-two', '2026-07-22T00:02:00.000Z');
		expect(await captureUserBaselineForRun(context, WORKSTREAM_ID, 'chat-a', 'run-two')).toBeNull();

		await writeFile(join(repo, 'between-runs.txt'), 'written by hand\n');
		insertOpenRun(db, 'chat-a', 'run-three', '2026-07-22T00:03:00.000Z');
		const between = await captureUserBaselineForRun(context, WORKSTREAM_ID, 'chat-a', 'run-three');
		if (!between) throw new Error('a hand edit after the last run is recorded');
		expect(await treeFiles(repo, between.gitCommit)).toContain('between-runs.txt');

		expect((await realGit(repo, ['log', '--oneline', 'HEAD'])).trim().split('\n')).toHaveLength(1);
	});

	it('workstream deletion collects user baseline refs with the rest', async () => {
		const { db, repo, context } = await harness();
		await writeFile(join(repo, 'tracked.txt'), 'human dirt\n');
		insertOpenRun(db, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z');
		const baseline = await captureUserBaselineForRun(context, WORKSTREAM_ID, 'chat-a', 'run-one');
		if (!baseline) throw new Error('dirty checkout');
		await captureCheckpointForRun(context, WORKSTREAM_ID, 'chat-a', 'run-one');
		await writeFile(join(repo, 'tracked.txt'), 'agent output\n');
		markRunCompleted(db, 'run-one');
		await captureRunChangesForTerminal(context, 'run-one');

		const refs = listWorkstreamSnapshotRefs(db, WORKSTREAM_ID);
		expect(refs.userBaselineRefs).toEqual([baseline.gitRef]);
		await deleteWorkstreamSnapshotRefs(db, repo, WORKSTREAM_ID);
		for (const ref of [...refs.checkpointRefs, ...refs.runChangeRefs, ...refs.userBaselineRefs]) {
			expect(await refExists(repo, ref)).toBe(false);
		}
	});
});

describe('restore', () => {
	it('the open-run flag undo reads is the one restore refuses on', async () => {
		const { db, context } = await harness();
		insertOpenRun(db, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z');
		const checkpoint = await captureCheckpointForRun(context, WORKSTREAM_ID, 'chat-a', 'run-one');
		bindCheckpointToUserMessage(db, checkpoint.id, 1);
		markRunCompleted(db, 'run-one');

		insertOpenRun(db, 'chat-b', 'run-sibling', '2026-07-22T00:02:00.000Z');
		expect(workstreamHasOpenRun(db, WORKSTREAM_ID)).toBe(true);
		await expect(restoreCheckpoint(context, WORKSTREAM_ID, checkpoint.id)).rejects.toMatchObject({
			kind: 'run-active',
			message: 'wait for the active run to finish before restoring a checkpoint',
		});

		markRunCompleted(db, 'run-sibling');
		expect(workstreamHasOpenRun(db, WORKSTREAM_ID)).toBe(false);
		await expect(restoreCheckpoint(context, WORKSTREAM_ID, checkpoint.id)).resolves.toMatchObject({
			sessionId: 'chat-a',
			removedRunCount: 0,
			restoreSeq: expect.any(Number),
		});
	});

	it('a git failure during undo says what failed in user terms, without git jargon', async () => {
		const { db, repo, context } = await harness();
		insertOpenRun(db, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z');
		const checkpoint = await captureCheckpointForRun(context, WORKSTREAM_ID, 'chat-a', 'run-one');
		bindCheckpointToUserMessage(db, checkpoint.id, 1);
		markRunCompleted(db, 'run-one');
		await writeFile(join(repo, 'tracked.txt'), 'written by the agent\n');
		await writeFile(join(repo, '.git', 'index.lock'), '');

		await expect(restoreCheckpoint(context, WORKSTREAM_ID, checkpoint.id)).rejects.toMatchObject({
			kind: 'git',
			message:
				"Couldn't restore the files from before this turn: Git is busy in this workstream (index.lock). Try again in a moment.",
		});
	});

	it('an inherited turn of a forked chat rewinds the fork and reverts the parent runs after it', async () => {
		const { db, repo, context } = await harness();
		const turn = async (runId: string, startedAt: string, text: string) => {
			insertOpenRun(db, 'chat-a', runId, startedAt);
			const checkpoint = await captureCheckpointForRun(context, WORKSTREAM_ID, 'chat-a', runId);
			const seq = appendEvent(db, 'chat-a', runId, 'user.message', {
				text,
				checkpointId: checkpoint.id,
			});
			bindCheckpointToUserMessage(db, checkpoint.id, seq);
			await writeFile(join(repo, 'tracked.txt'), `${text}\n`);
			markRunCompleted(db, runId);
			await captureRunChangesForTerminal(context, runId);
		};
		await turn('run-one', '2026-07-22T00:00:01.000Z', 'one');
		await turn('run-two', '2026-07-22T00:02:00.000Z', 'two');
		insertSession(db, {
			id: 'chat-fork',
			workstreamId: WORKSTREAM_ID,
			model: null,
			providerSessionId: null,
			status: 'idle',
			startedAt: '2026-07-22T00:05:00.000Z',
		});
		run(db, "UPDATE agent_sessions SET forked_from_session_id = 'chat-a' WHERE id = 'chat-fork'");
		const inherited = { checkpointUnavailable: 'inherited from parent chat' };
		const forkedSeq = appendEvent(db, 'chat-fork', 'run-one', 'user.message', {
			text: 'one',
			...inherited,
		});
		appendEvent(db, 'chat-fork', 'run-two', 'user.message', { text: 'two', ...inherited });

		db.exec(MIGRATION_0033_FORKED_TURN_CHECKPOINTS);
		const forkedTurn = listEventRowsForSession(db, 'chat-fork', 0)[0]?.payload;
		if (!isRecord(forkedTurn) || typeof forkedTurn['checkpointId'] !== 'string') {
			throw new Error('the inherited turn has no restore point');
		}
		expect(forkedTurn).not.toHaveProperty('checkpointUnavailable');

		await expect(
			restoreCheckpoint(context, WORKSTREAM_ID, forkedTurn['checkpointId']),
		).resolves.toMatchObject({ sessionId: 'chat-fork', removedRunCount: 2 });
		expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('base\n');
		const parentKinds = listEventRowsForSession(db, 'chat-a', 0).map((row) => row.kind);
		expect(parentKinds.filter((kind) => kind === 'run.obsoleted')).toHaveLength(2);
		const superseded = listEventRowsForSession(db, 'chat-fork', 0).find(
			(row) => row.kind === 'turn.superseded',
		)?.payload;
		expect(superseded).toMatchObject({ fromSeq: forkedSeq });
	});

	it('an unknown checkpoint is refused by id', async () => {
		const { context } = await harness();
		await expect(restoreCheckpoint(context, WORKSTREAM_ID, 'checkpoint-nope')).rejects.toThrow(
			new CheckpointError('not-found', 'checkpoint `checkpoint-nope` not found'),
		);
	});

	it('an unbound checkpoint is refused before anything touches the worktree', async () => {
		const { db, repo, context } = await harness();
		insertOpenRun(db, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z');
		const checkpoint = await captureCheckpointForRun(context, WORKSTREAM_ID, 'chat-a', 'run-one');
		expect(checkpoint.userMessageSeq).toBeNull();
		markRunCompleted(db, 'run-one');

		await writeFile(join(repo, 'tracked.txt'), 'rewritten by the agent\n');
		await writeFile(join(repo, 'by-hand.md'), 'hand written, exists nowhere else\n');
		const before = await worktreeSnapshotTree(repo);

		await expect(restoreCheckpoint(context, WORKSTREAM_ID, checkpoint.id)).rejects.toMatchObject({
			kind: 'db',
			message: `checkpoint database error: db invariant failed: checkpoint \`${checkpoint.id}\` is not bound to a user message`,
		});

		expect(await worktreeSnapshotTree(repo)).toBe(before);
		expect(await readFile(join(repo, 'by-hand.md'), 'utf8')).toBe(
			'hand written, exists nowhere else\n',
		);
		expect(await listRefs(repo, SALVAGE_REF_NAMESPACE)).toEqual([]);
	});

	it('work done by hand after the run is salvaged before undo restores it', async () => {
		const { db, repo, context } = await harness();
		insertOpenRun(db, 'chat-a', 'run-one', '2026-07-22T00:00:01.000Z');
		const checkpoint = await captureCheckpointForRun(context, WORKSTREAM_ID, 'chat-a', 'run-one');
		const seq = appendEvent(db, 'chat-a', 'run-one', 'user.message', {});
		bindCheckpointToUserMessage(db, checkpoint.id, seq);
		await writeFile(join(repo, 'tracked.txt'), 'written by the agent\n');
		markRunCompleted(db, 'run-one');
		await captureRunChangesForTerminal(context, 'run-one');

		await mkdir(join(repo, 'docs'));
		await writeFile(join(repo, 'docs/notes.md'), 'notes only I have\n');
		await writeFile(join(repo, 'tracked.txt'), 'hand edit on top of the agent\n');

		await expect(restoreCheckpoint(context, WORKSTREAM_ID, checkpoint.id)).resolves.toMatchObject({
			sessionId: 'chat-a',
			removedRunCount: 1,
			restoreSeq: expect.any(Number),
		});

		expect(existsSync(join(repo, 'docs/notes.md'))).toBe(false);
		expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('base\n');

		const refs = await listRefs(repo, SALVAGE_REF_NAMESPACE);
		expect(refs).toHaveLength(1);
		const salvage = refs[0]!;
		expect(salvage.startsWith(`${SALVAGE_REF_NAMESPACE}${WORKSTREAM_ID}.undo.`)).toBe(true);
		expect(await treeFiles(repo, salvage)).toContain('docs/notes.md');
		expect(await realGit(repo, ['show', `${salvage}:tracked.txt`])).toBe(
			'hand edit on top of the agent\n',
		);
	});
});
