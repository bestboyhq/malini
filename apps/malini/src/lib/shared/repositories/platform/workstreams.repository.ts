import type { MaliniDatabase } from '$main/db/driver';
import { upsertProject, type Project } from './projects.repository';
import { invariant } from '$main/errors';
import { all, column, get, run, scalar } from '$main/db/rows';
import type { MergedPullRequest, Workstream, WorkstreamStatus } from '$contract/repositories';
import { isGeneratedWorkstreamName } from '$shared/repositories/domain/workstream-names';

export type { Workstream, WorkstreamStatus };

export interface ArchivedWorkstreamRecord extends Workstream {
	readonly archivedAt: string;
	readonly archivedRef: string | null;
	readonly mergedPullRequest: MergedPullRequest | null;
	readonly savedForLater: boolean;
	readonly clearedFromStarter: boolean;
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
	scope: string | null;
	started_by: string | null;
}

const WORKSTREAM_COLUMNS =
	'id, project_id, name, path, branch, base_branch, status, created_at, scope, started_by';

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
		scope: row.scope,
		startedBy: row.started_by,
	};
}

export function upsertWorkstream(db: MaliniDatabase, workstream: Workstream): void {
	run(
		db,
		`INSERT INTO workstreams
		   (id, project_id, name, path, branch, base_branch, status, created_at, scope, started_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
		workstream.scope,
		workstream.startedBy,
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

export function listStartedWorkstreams(db: MaliniDatabase, starterId: string): Workstream[] {
	return all<WorkstreamRow>(
		db,
		`SELECT ${WORKSTREAM_COLUMNS} FROM workstreams WHERE started_by = ?`,
		starterId,
	).map(workstreamFromRow);
}

export function workstreamActiveTimes(db: MaliniDatabase): Map<string, string> {
	return new Map(
		all<{ workstream_id: string; active_at: string }>(
			db,
			`SELECT s.workstream_id,
			   MAX(MAX(s.started_at), COALESCE(MAX(r.started_at), ''), COALESCE(MAX(r.completed_at), '')) AS active_at
			 FROM agent_sessions s
			 LEFT JOIN agent_runs r ON r.session_id = s.id AND r.automated = 0
			 WHERE s.origin = 'user'
			 GROUP BY s.workstream_id`,
		).map((row) => [row.workstream_id, row.active_at]),
	);
}

interface ArchivedWorkstreamRow extends WorkstreamRow {
	archived_at: string | null;
	archived_ref: string | null;
	merged_pull_request_number: number | null;
	merged_pull_request_url: string | null;
	saved_for_later: number;
	cleared_from_starter: number;
}

const ARCHIVED_WORKSTREAM_COLUMNS = `${WORKSTREAM_COLUMNS}, archived_at, archived_ref,
	merged_pull_request_number, merged_pull_request_url, saved_for_later, cleared_from_starter`;

function archivedWorkstreamFromRow(row: ArchivedWorkstreamRow): ArchivedWorkstreamRecord {
	return {
		...workstreamFromRow(row),
		archivedAt: row.archived_at ?? row.created_at,
		archivedRef: row.archived_ref,
		mergedPullRequest:
			row.merged_pull_request_number === null
				? null
				: { number: row.merged_pull_request_number, url: row.merged_pull_request_url },
		savedForLater: row.saved_for_later === 1,
		clearedFromStarter: row.cleared_from_starter === 1,
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

export function workstreamAwaitsName(db: MaliniDatabase, workstreamId: string): boolean {
	const workstream = getWorkstream(db, workstreamId);
	if (workstream === null || !isGeneratedWorkstreamName(workstream.name)) return false;
	return (
		scalar(
			db,
			`SELECT COUNT(*) FROM agent_runs r
			 JOIN agent_sessions s ON s.id = r.session_id
			 WHERE s.workstream_id = ? AND s.origin = 'user' AND r.automated = 0`,
			workstreamId,
		) === 0
	);
}

export function renameWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
	name: string,
): string | null {
	const workstream = getWorkstream(db, workstreamId);
	if (workstream === null) return null;
	const candidate = freeWorkstreamName(db, workstream.projectId, workstreamId, name);
	run(db, 'UPDATE workstreams SET name = ? WHERE id = ?', candidate, workstreamId);
	return candidate;
}

export function freeWorkstreamName(
	db: MaliniDatabase,
	projectId: string,
	workstreamId: string,
	name: string,
): string {
	const lower = (s: string) => s.trim().toLowerCase();
	const taken = new Set(
		all<{ name: string }>(
			db,
			`SELECT name FROM workstreams
			 WHERE project_id = ? AND id != ? AND status != 'archived'`,
			projectId,
			workstreamId,
		).map((row) => lower(row.name)),
	);
	let candidate = name;
	let suffix = 2;
	while (taken.has(lower(candidate))) {
		candidate = `${name} ${suffix}`;
		suffix += 1;
	}
	return candidate;
}

export function archiveWorkstreamRecord(
	db: MaliniDatabase,
	workstreamId: string,
	archived: Readonly<{ ref: string | null; at: string; savedForLater: boolean }>,
): void {
	db.transaction(() => {
		refuseWhileRunsAreOpen(db, workstreamId, 'archive');
		run(
			db,
			`UPDATE workstreams SET status = 'archived', archived_at = ?, archived_ref = ?,
			   saved_for_later = ?
			 WHERE id = ?`,
			archived.at,
			archived.ref,
			archived.savedForLater ? 1 : 0,
			workstreamId,
		);
	});
}

export function moveArchivedWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
	savedForLater: boolean,
): boolean {
	const { changes } = run(
		db,
		`UPDATE workstreams SET saved_for_later = ?
		 WHERE id = ? AND status = 'archived' AND saved_for_later != ?`,
		savedForLater ? 1 : 0,
		workstreamId,
		savedForLater ? 1 : 0,
	);
	return changes > 0;
}

export function clearMergedFromStarter(db: MaliniDatabase, workstreamIds: readonly string[]): void {
	db.transaction(() => {
		for (const workstreamId of workstreamIds) {
			run(
				db,
				`UPDATE workstreams SET cleared_from_starter = 1
				 WHERE id = ? AND status = 'archived' AND merged_pull_request_number IS NOT NULL`,
				workstreamId,
			);
		}
	});
}

export function recordMergedPullRequest(
	db: MaliniDatabase,
	workstreamId: string,
	pullRequest: MergedPullRequest | null,
): void {
	run(
		db,
		'UPDATE workstreams SET merged_pull_request_number = ?, merged_pull_request_url = ? WHERE id = ?',
		pullRequest?.number ?? null,
		pullRequest?.url ?? null,
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
		   archived_ref = NULL, merged_pull_request_number = NULL, merged_pull_request_url = NULL,
		   saved_for_later = 0, cleared_from_starter = 0
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

export function mergedPullRequestOf(
	db: MaliniDatabase,
	workstreamId: string,
): MergedPullRequest | null {
	const row = get<
		Pick<ArchivedWorkstreamRow, 'merged_pull_request_number' | 'merged_pull_request_url'>
	>(
		db,
		'SELECT merged_pull_request_number, merged_pull_request_url FROM workstreams WHERE id = ?',
		workstreamId,
	);
	return row?.merged_pull_request_number == null
		? null
		: { number: row.merged_pull_request_number, url: row.merged_pull_request_url };
}
