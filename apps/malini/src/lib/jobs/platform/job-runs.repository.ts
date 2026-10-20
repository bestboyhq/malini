import type { JobRunOrigin, JobRunRecord, JobRunStatus } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run, scalar } from '$main/db/rows';

interface JobRunRow {
	id: string;
	definition_id: string;
	title: string;
	workstream_id: string | null;
	repository_id: string | null;
	session_id: string | null;
	agent_run_id: string | null;
	origin: JobRunOrigin;
	status: JobRunStatus;
	detail: string | null;
	chat_session_id: string | null;
	chat_after_run_id: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
}

const COLUMNS =
	'id, definition_id, title, workstream_id, repository_id, session_id, agent_run_id, origin, status, detail, chat_session_id, chat_after_run_id, created_at, started_at, finished_at';

const UNFINISHED = "status IN ('queued', 'running', 'needs-you')";

function fromRow(row: JobRunRow): JobRunRecord {
	return {
		id: row.id,
		definitionId: row.definition_id,
		title: row.title,
		workstreamId: row.workstream_id,
		repositoryId: row.repository_id,
		sessionId: row.session_id,
		agentRunId: row.agent_run_id,
		origin: row.origin,
		status: row.status,
		detail: row.detail,
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
		`INSERT INTO job_runs (${COLUMNS}, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		jobRun.id,
		jobRun.definitionId,
		jobRun.title,
		jobRun.workstreamId,
		jobRun.repositoryId,
		jobRun.sessionId,
		jobRun.agentRunId,
		jobRun.origin,
		jobRun.status,
		jobRun.detail,
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

export function listChatJobRuns(db: MaliniDatabase, chatSessionId: string): JobRunRecord[] {
	return all<JobRunRow>(
		db,
		`SELECT ${COLUMNS} FROM job_runs WHERE chat_session_id = ? ORDER BY created_at, rowid`,
		chatSessionId,
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

export function countUnfinishedJobRuns(db: MaliniDatabase, definitionId: string): number {
	return scalar(
		db,
		`SELECT COUNT(*) FROM job_runs WHERE definition_id = ? AND ${UNFINISHED}`,
		definitionId,
	);
}
