import type { MaliniDatabase } from '$main/db/driver';
import { upsertProject, type Project } from './projects.repository';
import { invariant } from '$main/errors';
import { all, column, get, run, scalar } from '$main/db/rows';
import type { MergedPullRequest, Workstream, WorkstreamStatus } from '$contract/repositories';

export type { Workstream, WorkstreamStatus };

export interface ArchivedWorkstreamRecord extends Workstream {
	readonly archivedAt: string;
	readonly archivedRef: string | null;
	readonly mergedPullRequest: MergedPullRequest | null;
}

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
		`SELECT ${WORKSTREAM_COLUMNS} FROM workstreams WHERE status != 'archived' ORDER BY created_at DESC`,
	).map(workstreamFromRow);
}

interface ArchivedWorkstreamRow extends WorkstreamRow {
	archived_at: string | null;
	archived_ref: string | null;
	merged_pull_request_number: number | null;
	merged_pull_request_url: string | null;
}

const ARCHIVED_WORKSTREAM_COLUMNS = `${WORKSTREAM_COLUMNS}, archived_at, archived_ref,
	merged_pull_request_number, merged_pull_request_url`;

function archivedWorkstreamFromRow(row: ArchivedWorkstreamRow): ArchivedWorkstreamRecord {
	return {
		...workstreamFromRow(row),
		archivedAt: row.archived_at ?? row.created_at,
		archivedRef: row.archived_ref,
		mergedPullRequest:
			row.merged_pull_request_number === null
				? null
				: { number: row.merged_pull_request_number, url: row.merged_pull_request_url },
	};
}

export function listArchivedWorkstreams(db: MaliniDatabase): ArchivedWorkstreamRecord[] {
	return all<ArchivedWorkstreamRow>(
		db,
		`SELECT ${ARCHIVED_WORKSTREAM_COLUMNS} FROM workstreams
		 WHERE status = 'archived' ORDER BY archived_at DESC, created_at DESC`,
	).map(archivedWorkstreamFromRow);
}

export function getArchivedWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
): ArchivedWorkstreamRecord | null {
	const row = get<ArchivedWorkstreamRow>(
		db,
		`SELECT ${ARCHIVED_WORKSTREAM_COLUMNS} FROM workstreams WHERE id = ? AND status = 'archived'`,
		workstreamId,
	);
	return row ? archivedWorkstreamFromRow(row) : null;
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
			 WHERE s.workstream_id = ? AND s.origin = 'user' AND r.automated = 0`,
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

export function archiveWorkstreamRecord(
	db: MaliniDatabase,
	workstreamId: string,
	archivedRef: string | null,
	archivedAt: string,
): void {
	db.transaction(() => {
		refuseWhileRunsAreOpen(db, workstreamId, 'archive');
		run(
			db,
			`UPDATE workstreams SET status = 'archived', archived_at = ?, archived_ref = ?
			 WHERE id = ?`,
			archivedAt,
			archivedRef,
			workstreamId,
		);
	});
}

export function recordMergedPullRequest(
	db: MaliniDatabase,
	workstreamId: string,
	pullRequest: MergedPullRequest,
): void {
	run(
		db,
		'UPDATE workstreams SET merged_pull_request_number = ?, merged_pull_request_url = ? WHERE id = ?',
		pullRequest.number,
		pullRequest.url,
		workstreamId,
	);
}

export function restoreWorkstreamRecord(
	db: MaliniDatabase,
	workstreamId: string,
	path: string,
	branch: string,
): void {
	run(
		db,
		`UPDATE workstreams SET status = 'active', path = ?, branch = ?, archived_at = NULL,
		   archived_ref = NULL, merged_pull_request_number = NULL, merged_pull_request_url = NULL
		 WHERE id = ? AND status = 'archived'`,
		path,
		branch,
		workstreamId,
	);
}

function refuseWhileRunsAreOpen(
	db: MaliniDatabase,
	workstreamId: string,
	action: 'archive' | 'delete',
): void {
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
			`cannot ${action} workstream \`${workstreamId}\` while agent runs are active: ${openRunIds.join(', ')}`,
		);
	}
}

export function deleteWorkstream(db: MaliniDatabase, workstreamId: string): void {
	db.transaction(() => {
		refuseWhileRunsAreOpen(db, workstreamId, 'delete');
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
		run(db, 'INSERT OR IGNORE INTO deleted_workstreams (id) VALUES (?)', workstreamId);
	});
}

export function workstreamWasDeleted(db: MaliniDatabase, workstreamId: string): boolean {
	return scalar(db, 'SELECT COUNT(*) FROM deleted_workstreams WHERE id = ?', workstreamId) > 0;
}
