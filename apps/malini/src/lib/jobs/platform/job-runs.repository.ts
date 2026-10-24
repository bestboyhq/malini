import type { JobRunOrigin, JobRunRecord, JobRunStatus } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, column, get, run, scalar } from '$main/db/rows';

interface JobRunRow {
	id: string;
	definition_id: string;
	title: string;
	workstream_id: string | null;
	repository_id: string | null;
	scope: string | null;
	session_id: string | null;
	agent_run_id: string | null;
	origin: JobRunOrigin;
	status: JobRunStatus;
	detail: string | null;
	parent_run_id: string | null;
	chat_session_id: string | null;
	chat_after_run_id: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
}

const COLUMNS =
	'id, definition_id, title, workstream_id, repository_id, scope, session_id, agent_run_id, origin, status, detail, parent_run_id, chat_session_id, chat_after_run_id, created_at, started_at, finished_at';

const UNFINISHED = "status IN ('waiting', 'queued', 'running', 'needs-you')";

const STARTED_OR_QUEUED = "status IN ('queued', 'running', 'needs-you')";

function fromRow(row: JobRunRow): JobRunRecord {
	return {
		id: row.id,
		definitionId: row.definition_id,
		title: row.title,
		workstreamId: row.workstream_id,
		repositoryId: row.repository_id,
		scope: row.scope,
		sessionId: row.session_id,
		agentRunId: row.agent_run_id,
		origin: row.origin,
		status: row.status,
		detail: row.detail,
		parentRunId: row.parent_run_id,
		chatSessionId: row.chat_session_id,
		chatAfterRunId: row.chat_after_run_id,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

export function insertJobRun(
	db: MaliniDatabase,
	jobRun: JobRunRecord,
	context: string | null,
): void {
	run(
		db,
		`INSERT INTO job_runs (${COLUMNS}, context)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		jobRun.id,
		jobRun.definitionId,
		jobRun.title,
		jobRun.workstreamId,
		jobRun.repositoryId,
		jobRun.scope,
		jobRun.sessionId,
		jobRun.agentRunId,
		jobRun.origin,
		jobRun.status,
		jobRun.detail,
		jobRun.parentRunId,
		jobRun.chatSessionId,
		jobRun.chatAfterRunId,
		jobRun.createdAt,
		jobRun.startedAt,
		jobRun.finishedAt,
		context,
	);
}

export function getJobRun(db: MaliniDatabase, id: string): JobRunRecord | null {
	const row = get<JobRunRow>(db, `SELECT ${COLUMNS} FROM job_runs WHERE id = ?`, id);
	return row ? fromRow(row) : null;
}

export function getJobRunContext(db: MaliniDatabase, id: string): string | null {
	return (
		get<{ context: string | null }>(db, 'SELECT context FROM job_runs WHERE id = ?', id)?.context ??
		null
	);
}

export function saveJobRun(db: MaliniDatabase, jobRun: JobRunRecord): void {
	run(
		db,
		`UPDATE job_runs
		 SET workstream_id = ?, session_id = ?, agent_run_id = ?, status = ?, detail = ?,
		     started_at = ?, finished_at = ?
		 WHERE id = ?`,
		jobRun.workstreamId,
		jobRun.sessionId,
		jobRun.agentRunId,
		jobRun.status,
		jobRun.detail,
		jobRun.startedAt,
		jobRun.finishedAt,
		jobRun.id,
	);
}

export function listUnfinishedJobRuns(db: MaliniDatabase): JobRunRecord[] {
	return all<JobRunRow>(
		db,
		`SELECT ${COLUMNS} FROM job_runs WHERE ${UNFINISHED} ORDER BY created_at, rowid`,
	).map(fromRow);
}

export function listRecentFinishedJobRuns(db: MaliniDatabase, limit: number): JobRunRecord[] {
	return all<JobRunRow>(
		db,
		`SELECT ${COLUMNS} FROM job_runs WHERE NOT ${UNFINISHED}
		 ORDER BY created_at DESC, rowid DESC LIMIT ?`,
		limit,
	).map(fromRow);
}

export function findActiveJobRunForSession(
	db: MaliniDatabase,
	sessionId: string,
): JobRunRecord | null {
	const row = get<JobRunRow>(
		db,
		`SELECT ${COLUMNS} FROM job_runs
		 WHERE session_id = ? AND status IN ('running', 'needs-you')
		 ORDER BY created_at DESC LIMIT 1`,
		sessionId,
	);
	return row ? fromRow(row) : null;
}

export function countStartedOrQueuedJobRuns(db: MaliniDatabase, definitionId: string): number {
	return scalar(
		db,
		`SELECT COUNT(*) FROM job_runs WHERE definition_id = ? AND ${STARTED_OR_QUEUED}`,
		definitionId,
	);
}

export function latestScheduledJobRun(
	db: MaliniDatabase,
	definitionId: string,
): JobRunRecord | null {
	const row = get<JobRunRow>(
		db,
		`SELECT ${COLUMNS} FROM job_runs WHERE definition_id = ? AND origin = 'schedule'
		 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
		definitionId,
	);
	return row ? fromRow(row) : null;
}

export function latestScheduledWorkstreamId(
	db: MaliniDatabase,
	definitionId: string,
): string | null {
	return (
		get<{ workstream_id: string }>(
			db,
			`SELECT workstream_id FROM job_runs
			 WHERE definition_id = ? AND origin = 'schedule' AND workstream_id IS NOT NULL
			 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
			definitionId,
		)?.workstream_id ?? null
	);
}

export function countUnfinishedJobRuns(db: MaliniDatabase, definitionId: string): number {
	return scalar(
		db,
		`SELECT COUNT(*) FROM job_runs WHERE definition_id = ? AND ${UNFINISHED}`,
		definitionId,
	);
}

export function listWaitingJobRuns(db: MaliniDatabase, definitionId: string): JobRunRecord[] {
	return all<JobRunRow>(
		db,
		`SELECT ${COLUMNS} FROM job_runs WHERE definition_id = ? AND status = 'waiting'
		 ORDER BY created_at, rowid`,
		definitionId,
	).map(fromRow);
}

export function jobRunChainDefinitionIds(
	db: MaliniDatabase,
	jobRunId: string,
	maxDepth: number,
): string[] {
	return column(
		db,
		`WITH RECURSIVE chain(definition_id, parent_run_id, depth) AS (
		   SELECT definition_id, parent_run_id, 1 FROM job_runs WHERE id = ?
		   UNION ALL
		   SELECT run.definition_id, run.parent_run_id, chain.depth + 1
		   FROM job_runs AS run JOIN chain ON run.id = chain.parent_run_id
		   WHERE chain.depth < ?
		 )
		 SELECT definition_id FROM chain`,
		jobRunId,
		maxDepth,
	);
}
