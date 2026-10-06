import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import { run, scalar } from '$main/db/rows';
import { seedWorkstream } from '$main/db/test-fixtures';
import { appendEvent } from '$lib/chat/platform/events.repository';
import { insertRun } from '$lib/chat/platform/runs.repository';
import { insertSession } from '$lib/chat/platform/sessions.repository';
import { getProject, listProjects, upsertProject } from './projects.repository';
import {
	deleteWorkstream,
	getWorkstream,
	listWorkstreams,
	upsertWorkstream,
	upsertWorkstreamBundle,
} from './workstreams.repository';

describe('projects and workstreams', () => {
	it('list returns all upserted rows, newest first', () => {
		const db = openMigratedDatabase(':memory:');
		for (const [id, createdAt] of [
			['p-1', '2026-07-03T00:00:01Z'],
			['p-2', '2026-07-03T00:00:02Z'],
		] as const) {
			upsertProject(db, { id, name: id, repoPath: `/tmp/${id}`, defaultBranch: 'main', createdAt });
			upsertWorkstream(db, {
				id: id.replace('p', 'w'),
				projectId: id,
				name: id.replace('p', 'w'),
				path: `/tmp/${id.replace('p', 'w')}`,
				branch: `malini/${id}`,
				baseBranch: 'main',
				status: 'active',
				createdAt,
			});
		}
		expect(listWorkstreams(db).map((row) => row.id)).toEqual(['w-2', 'w-1']);
		expect(listProjects(db).map((row) => row.id)).toEqual(['p-2', 'p-1']);
		expect(getProject(db, 'p-1')).toEqual({
			id: 'p-1',
			name: 'p-1',
			repoPath: '/tmp/p-1',
			defaultBranch: 'main',
			createdAt: '2026-07-03T00:00:01Z',
		});
		expect(getWorkstream(db, 'w-1')).toEqual({
			id: 'w-1',
			projectId: 'p-1',
			name: 'w-1',
			path: '/tmp/w-1',
			branch: 'malini/p-1',
			baseBranch: 'main',
			status: 'active',
			createdAt: '2026-07-03T00:00:01Z',
		});
		expect(getWorkstream(db, 'w-9')).toBeNull();
		upsertProject(db, {
			id: 'p-1',
			name: 'renamed',
			repoPath: '/tmp/p-1b',
			defaultBranch: 'dev',
			createdAt: 'ignored',
		});
		expect(getProject(db, 'p-1')).toMatchObject({
			name: 'renamed',
			repoPath: '/tmp/p-1b',
			defaultBranch: 'dev',
			createdAt: '2026-07-03T00:00:01Z',
		});
		db.close();
	});

	it('upserts a repository and its workstream together', () => {
		const db = openMigratedDatabase(':memory:');
		upsertWorkstreamBundle(
			db,
			{
				id: 'p-bundle',
				name: 'b',
				repoPath: '/tmp/b',
				defaultBranch: 'main',
				createdAt: '2026-07-03T00:00:02Z',
			},
			{
				id: 'w-bundle',
				projectId: 'p-bundle',
				name: 'b',
				path: '/tmp/wb',
				branch: 'malini/b',
				baseBranch: 'main',
				status: 'active',
				createdAt: '2026-07-03T00:00:02Z',
			},
		);
		expect(listProjects(db).map((row) => row.id)).toEqual(['p-bundle']);
		expect(getWorkstream(db, 'w-bundle')).toMatchObject({
			projectId: 'p-bundle',
			branch: 'malini/b',
		});
		expect(() =>
			upsertWorkstreamBundle(
				db,
				{
					id: 'p-rolled-back',
					name: 'r',
					repoPath: '/tmp/r',
					defaultBranch: 'main',
					createdAt: '2026-07-03T00:00:03Z',
				},
				{
					id: 'w-bundle',
					projectId: 'p-rolled-back',
					name: 'r',
					path: '/tmp/wr',
					branch: 'malini/r',
					baseBranch: 'main',
					status: 'not-a-status' as 'active',
					createdAt: '2026-07-03T00:00:03Z',
				},
			),
		).toThrow();
		expect(getProject(db, 'p-rolled-back')).toBeNull();
		db.close();
	});

	it('delete preserves every row until open runs are terminal, then is idempotent', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-delete-fence');
		insertSession(db, {
			id: 'session-delete-fence',
			workstreamId: 'workstream-delete-fence',
			model: 'anthropic/claude-sonnet-4-6',
			providerSessionId: null,
			status: 'running',
			startedAt: '2026-07-11T00:00:00Z',
		});
		insertRun(db, {
			id: 'run-delete-fence',
			sessionId: 'session-delete-fence',
			prompt: 'keep working',
			startedAt: '2026-07-11T00:00:00Z',
			completedAt: null,
			summary: null,
			error: null,
		});
		appendEvent(db, 'session-delete-fence', 'run-delete-fence', 'run.started', {});

		expect(() => deleteWorkstream(db, 'workstream-delete-fence')).toThrow(
			'db invariant failed: cannot delete workstream `workstream-delete-fence` while agent runs are active: run-delete-fence',
		);
		for (const table of ['workstreams', 'agent_sessions', 'agent_runs', 'agent_events']) {
			expect(scalar(db, `SELECT COUNT(*) FROM ${table}`)).toBe(1);
		}
		run(
			db,
			"UPDATE agent_runs SET completed_at = '2026-07-11T00:00:01Z', summary = 'cancelled' WHERE id = 'run-delete-fence'",
		);
		deleteWorkstream(db, 'workstream-delete-fence');
		deleteWorkstream(db, 'workstream-delete-fence');
		for (const table of ['workstreams', 'agent_sessions', 'agent_runs', 'agent_events']) {
			expect(scalar(db, `SELECT COUNT(*) FROM ${table}`)).toBe(0);
		}
		db.close();
	});
});
