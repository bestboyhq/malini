import type { MaliniDatabase } from '$main/db/driver';
import { upsertProject, type Project } from './projects.repository';
import { invariant } from '$main/errors';
import { all, column, get, run, scalar } from '$main/db/rows';
import type { Workstream, WorkstreamStatus } from '$contract/repositories';

export type { Workstream, WorkstreamStatus };

interface WorkstreamRow {
	id: string;
	project_id: string;
	name: string;
	path: string;
	branch: string;
	base_branch: string;
	status: WorkstreamStatus;
	created_at: string;
}

const WORKSTREAM_COLUMNS = 'id, project_id, name, path, branch, base_branch, status, created_at';

function workstreamFromRow(row: WorkstreamRow): Workstream {
	return {
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		path: row.path,
		branch: row.branch,
		baseBranch: row.base_branch,
		status: row.status,
		createdAt: row.created_at,
	};
}

export function upsertWorkstream(db: MaliniDatabase, workstream: Workstream): void {
	run(
		db,
		`INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   name=excluded.name,
		   path=excluded.path,
		   branch=excluded.branch,
		   base_branch=excluded.base_branch,
		   status=excluded.status`,
		workstream.id,
		workstream.projectId,
		workstream.name,
		workstream.path,
		workstream.branch,
		workstream.baseBranch,
		workstream.status,
		workstream.createdAt,
	);
}

export function upsertWorkstreamBundle(
	db: MaliniDatabase,
	project: Project,
	workstream: Workstream,
): void {
	db.transaction(() => {
		upsertProject(db, project);
		upsertWorkstream(db, workstream);
	});
}

export function listWorkstreams(db: MaliniDatabase): Workstream[] {
	return all<WorkstreamRow>(
		db,
		`SELECT ${WORKSTREAM_COLUMNS} FROM workstreams ORDER BY created_at DESC`,
	).map(workstreamFromRow);
}

export function getWorkstream(db: MaliniDatabase, workstreamId: string): Workstream | null {
	const row = get<WorkstreamRow>(
		db,
		`SELECT ${WORKSTREAM_COLUMNS} FROM workstreams WHERE id = ?`,
		workstreamId,
	);
	return row ? workstreamFromRow(row) : null;
}

export function workstreamHasUserRun(db: MaliniDatabase, workstreamId: string): boolean {
	return (
		scalar(
			db,
			`SELECT COUNT(*) FROM agent_runs r
			 JOIN agent_sessions s ON s.id = r.session_id
			 WHERE s.workstream_id = ? AND r.automated = 0`,
			workstreamId,
		) > 0
	);
}

export function renameWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
	name: string,
): string | null {
	const workstream = getWorkstream(db, workstreamId);
	if (workstream === null) return null;
	const taken = all<{ name: string }>(
		db,
		`SELECT name FROM workstreams
		 WHERE project_id = ? AND id != ? AND status != 'archived'`,
		workstream.projectId,
		workstreamId,
	).map((row) => row.name);
	let candidate = name;
	let suffix = 2;
	const lower = (s: string) => s.trim().toLowerCase();
	const takenSet = new Set(taken.map(lower));
	while (takenSet.has(lower(candidate))) {
		candidate = `${name} ${suffix}`;
		suffix += 1;
	}
	run(db, 'UPDATE workstreams SET name = ? WHERE id = ?', candidate, workstreamId);
	return candidate;
}

export function deleteWorkstream(db: MaliniDatabase, workstreamId: string): void {
	db.transaction(() => {
		const openRunIds = column(
			db,
			`SELECT r.id FROM agent_runs r
			 JOIN agent_sessions s ON r.session_id = s.id
			 WHERE s.workstream_id = ? AND r.completed_at IS NULL
			 ORDER BY r.started_at ASC, r.id ASC`,
			workstreamId,
		);
		if (openRunIds.length > 0) {
			throw invariant(
				`cannot delete workstream \`${workstreamId}\` while agent runs are active: ${openRunIds.join(', ')}`,
			);
		}
		run(db, 'DELETE FROM agent_checkpoints WHERE workstream_id = ?', workstreamId);
		run(db, 'DELETE FROM agent_user_baselines WHERE workstream_id = ?', workstreamId);
		run(
			db,
			`DELETE FROM agent_events WHERE session_id IN
			 (SELECT id FROM agent_sessions WHERE workstream_id = ?)`,
			workstreamId,
		);
		run(
			db,
			`DELETE FROM agent_runs WHERE session_id IN
			 (SELECT id FROM agent_sessions WHERE workstream_id = ?)`,
			workstreamId,
		);
		run(db, 'DELETE FROM agent_sessions WHERE workstream_id = ?', workstreamId);
		run(db, 'DELETE FROM workstreams WHERE id = ?', workstreamId);
	});
}
