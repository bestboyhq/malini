import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { seedWorkstream } from '$main/db/test-fixtures';
import { insertRun } from './runs.repository';
import { insertSession } from './sessions.repository';

export function seedInteractionContext(
	db: MaliniDatabase,
	workstreamId: string,
	sessionId: string,
	runId: string,
): void {
	seedWorkstream(db, workstreamId);
	insertSession(db, {
		id: sessionId,
		workstreamId,
		model: null,
		providerSessionId: null,
		status: 'waiting_for_approval',
		startedAt: '2026-07-22T00:00:00Z',
	});
	insertRun(db, {
		id: runId,
		sessionId,
		prompt: 'Read external context',
		startedAt: '2026-07-22T00:00:01Z',
		completedAt: null,
		summary: null,
		error: null,
	});
}

export function openChatTestDatabase(): MaliniDatabase {
	return openMigratedDatabase(':memory:');
}

export function seedChatWorkstream(db: MaliniDatabase, workstreamId: string, path: string): void {
	const now = new Date().toISOString();
	const projectId = `proj-${workstreamId}`;
	run(
		db,
		'INSERT OR IGNORE INTO projects (id, name, repo_path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
		projectId,
		workstreamId,
		'/tmp/test-repo',
		'main',
		now,
	);
	run(
		db,
		'INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		workstreamId,
		projectId,
		workstreamId,
		path,
		`malini/${workstreamId}`,
		'main',
		'active',
		now,
	);
}

export function seedChatSession(db: MaliniDatabase, sessionId: string, workstreamId: string): void {
	insertSession(db, {
		id: sessionId,
		workstreamId,
		model: null,
		providerSessionId: null,
		status: 'idle',
		startedAt: new Date().toISOString(),
	});
}
