import { describe, expect, it } from 'vitest';
import {
	insertRunChange,
	listRunChangesForSession,
	sessionChanges,
	terminalRunsWithoutChanges,
} from './changes.repository';
import {
	insertCheckpoint,
	insertUserBaseline,
	listWorkstreamSnapshotRefs,
} from './checkpoints.repository';
import { openMigratedDatabase } from '$main/db/open';
import { run, scalar } from '$main/db/rows';
import { insertRun } from './runs.repository';
import { seedInteractionContext } from './test-support';
import { deleteWorkstream } from '$shared/repositories/repositories.platform';

describe('checkpoints and run changes', () => {
	it('session changes sum per-file totals and name the terminal runs still missing an interval', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'workstream-net', 'session-net', 'run-1');
		expect(() => sessionChanges(db, 'session-missing')).toThrow(
			'agent session `session-missing` does not exist',
		);
		expect(sessionChanges(db, 'session-net')).toEqual({
			sessionId: 'session-net',
			runs: [],
			files: [],
			beforeCommit: null,
			afterCommit: null,
			capturedAt: null,
		});
		expect(terminalRunsWithoutChanges(db, 'session-net')).toEqual([]);
		run(db, "UPDATE agent_runs SET completed_at = '2026-07-22T00:00:02Z' WHERE id = 'run-1'");
		expect(terminalRunsWithoutChanges(db, 'session-net')).toEqual(['run-1']);

		insertRun(db, {
			id: 'run-2',
			sessionId: 'session-net',
			prompt: 'again',
			startedAt: '2026-07-22T00:00:03Z',
			completedAt: '2026-07-22T00:00:04Z',
			summary: null,
			error: null,
		});
		insertCheckpoint(db, {
			id: 'cp-2',
			workstreamId: 'workstream-net',
			sessionId: 'session-net',
			runId: 'run-2',
			userMessageSeq: 1,
			gitRef: 'refs/malini/checkpoints/workstream-net/cp-2',
			gitCommit: 'before-2',
			createdAt: '2026-07-22T00:00:03Z',
		});
		insertRunChange(db, {
			runId: 'run-2',
			checkpointId: 'cp-2',
			beforeCommit: 'before-2',
			afterCommit: 'after-2',
			afterRef: 'refs/malini/run-changes/workstream-net/run-2',
			capturedAt: '2026-07-22T00:00:05Z',
			files: [
				{ path: 'b.txt', additions: 2, deletions: 1, isBinary: false },
				{ path: 'a.bin', additions: 0, deletions: 0, isBinary: true },
			],
		});
		const changes = sessionChanges(db, 'session-net');
		expect(terminalRunsWithoutChanges(db, 'session-net')).toEqual(['run-1']);
		expect(changes).toMatchObject({
			beforeCommit: 'before-2',
			afterCommit: 'after-2',
			capturedAt: '2026-07-22T00:00:05Z',
		});
		expect(changes.files).toEqual([
			{ path: 'a.bin', additions: 0, deletions: 0, isBinary: true, runIds: ['run-2'] },
			{ path: 'b.txt', additions: 2, deletions: 1, isBinary: false, runIds: ['run-2'] },
		]);
		expect(listRunChangesForSession(db, 'session-net').map((change) => change.runId)).toEqual([
			'run-2',
		]);
		db.close();
	});

	it('deleting a workstream takes its user baselines with it', () => {
		const db = openMigratedDatabase(':memory:');
		seedInteractionContext(db, 'workstream-gone', 'session-gone', 'run-gone');
		insertUserBaseline(db, {
			id: 'user-baseline-gone',
			workstreamId: 'workstream-gone',
			sessionId: 'session-gone',
			runId: 'run-gone',
			gitRef: 'refs/malini/user-baselines/workstream-gone/user-baseline-gone',
			gitCommit: 'abc123',
			createdAt: '2026-07-23T08:08:18.127Z',
		});
		run(
			db,
			"UPDATE agent_runs SET completed_at = '2026-07-23T09:00:00.000Z' WHERE id = 'run-gone'",
		);
		expect(listWorkstreamSnapshotRefs(db, 'workstream-gone').userBaselineRefs).toHaveLength(1);
		deleteWorkstream(db, 'workstream-gone');
		expect(scalar(db, 'SELECT COUNT(*) FROM agent_user_baselines')).toBe(0);
		db.close();
	});
});
