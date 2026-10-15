import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import type { MaliniDatabase } from '$main/db/driver';
import { readActivity } from './register';

describe('readActivity', () => {
	it('counts every run per local day and per repository, with job runs, agent time and open runs', () => {
		const db = openMigratedDatabase(':memory:');
		seedRepository(db, 'bestboyhq/malini', 'local__bestboyhq__malini', 'ws-malini');
		seedProject(db, 'local__someone__elsewhere', 'ws-elsewhere');
		seedSession(db, 'chat', 'ws-malini', 'user');
		seedSession(db, 'job', 'ws-malini', 'job');
		seedSession(db, 'other', 'ws-elsewhere', 'user');
		seedRun(db, 'run-1', 'chat', '2026-10-14T12:00:00.000Z', '2026-10-14T12:10:00.000Z');
		seedRun(db, 'run-2', 'job', '2026-10-14T12:00:00.000Z', '2026-10-14T12:01:00.000Z');
		seedRun(db, 'run-3', 'other', '2026-10-15T12:00:00.000Z', null);

		expect(readActivity(db, new Date(2026, 9, 15, 12))).toEqual({
			today: '2026-10-15',
			runs: 3,
			jobRuns: 1,
			agentSeconds: 660,
			runningAgents: 1,
			days: [
				{ date: '2026-10-14', runs: 2 },
				{ date: '2026-10-15', runs: 1 },
			],
			repositories: [
				{ fullName: 'bestboyhq/malini', runs: 2 },
				{ fullName: 'local__someone__elsewhere', runs: 1 },
			],
		});
	});
});

function seedRepository(
	db: MaliniDatabase,
	fullName: string,
	projectId: string,
	workstreamId: string,
): void {
	run(
		db,
		`INSERT INTO connected_repositories (id, full_name, default_branch, local_path, remote_url, created_at)
		 VALUES (?, ?, 'main', NULL, ?, '2026-10-01T00:00:00Z')`,
		`connected-${projectId}`,
		fullName,
		`https://github.com/${fullName}.git`,
	);
	seedProject(db, projectId, workstreamId);
}

function seedProject(db: MaliniDatabase, projectId: string, workstreamId: string): void {
	run(
		db,
		`INSERT INTO projects (id, name, repo_path, default_branch, created_at)
		 VALUES (?, ?, '/tmp/repo', 'main', '2026-10-01T00:00:00Z')`,
		projectId,
		projectId,
	);
	run(
		db,
		`INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at)
		 VALUES (?, ?, ?, '/tmp/ws', 'malini/ws', 'main', 'active', '2026-10-01T00:00:00Z')`,
		workstreamId,
		projectId,
		workstreamId,
	);
}

function seedSession(
	db: MaliniDatabase,
	sessionId: string,
	workstreamId: string,
	origin: 'user' | 'job',
): void {
	run(
		db,
		`INSERT INTO agent_sessions (id, workstream_id, status, started_at, origin)
		 VALUES (?, ?, 'idle', '2026-10-01T00:00:00Z', ?)`,
		sessionId,
		workstreamId,
		origin,
	);
}

function seedRun(
	db: MaliniDatabase,
	runId: string,
	sessionId: string,
	startedAt: string,
	completedAt: string | null,
): void {
	run(
		db,
		`INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at)
		 VALUES (?, ?, 'prompt', ?, ?)`,
		runId,
		sessionId,
		startedAt,
		completedAt,
	);
}
