import {
	ACTIVE_AUTOMATION_RUN_STATUSES,
	PENDING_AUTOMATION_RUN_STATUSES,
	UNFINISHED_AUTOMATION_RUN_STATUSES,
	type AutomationRunOrigin,
	type AutomationRunRecord,
	type AutomationRunStatus,
} from '$contract/automations';
import type { MaliniDatabase } from '$main/db/driver';
import { all, column, get, run, scalar } from '$main/db/rows';

interface AutomationRunRow {
	id: string;
	definition_id: string;
	title: string;
	workstream_id: string | null;
	repository_id: string | null;
	scope: string | null;
	session_id: string | null;
	agent_run_id: string | null;
	origin: AutomationRunOrigin;
	status: AutomationRunStatus;
	interrupted: number;
	detail: string | null;
	parent_run_id: string | null;
	chat_session_id: string | null;
	chat_after_run_id: string | null;
	chain_id: string;
	requests: number;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
}

const COLUMNS =
	'id, definition_id, title, workstream_id, repository_id, scope, session_id, agent_run_id, origin, status, interrupted, detail, parent_run_id, chat_session_id, chat_after_run_id, chain_id, requests, created_at, started_at, finished_at';

function statusIn(statuses: readonly AutomationRunStatus[]): string {
	return `status IN (${statuses.map((status) => `'${status}'`).join(', ')})`;
}

const UNFINISHED = statusIn(UNFINISHED_AUTOMATION_RUN_STATUSES);

const ACTIVE = statusIn(ACTIVE_AUTOMATION_RUN_STATUSES);

const PENDING = statusIn(PENDING_AUTOMATION_RUN_STATUSES);

const STARTED_OR_QUEUED = statusIn(
	UNFINISHED_AUTOMATION_RUN_STATUSES.filter((status) => status !== 'waiting'),
);

function fromRow(row: AutomationRunRow): AutomationRunRecord {
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
		interrupted: row.interrupted === 1,
		detail: row.detail,
		parentRunId: row.parent_run_id,
		chatSessionId: row.chat_session_id,
		chatAfterRunId: row.chat_after_run_id,
		chainId: row.chain_id,
		requests: row.requests,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

export function insertAutomationRun(
	db: MaliniDatabase,
	automationRun: AutomationRunRecord,
	context: string | null,
): void {
	run(
		db,
		`INSERT INTO automation_runs (${COLUMNS}, context)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		automationRun.id,
		automationRun.definitionId,
		automationRun.title,
		automationRun.workstreamId,
		automationRun.repositoryId,
		automationRun.scope,
		automationRun.sessionId,
		automationRun.agentRunId,
		automationRun.origin,
		automationRun.status,
		automationRun.interrupted === true ? 1 : 0,
		automationRun.detail,
		automationRun.parentRunId,
		automationRun.chatSessionId,
		automationRun.chatAfterRunId,
		automationRun.chainId,
		automationRun.requests,
		automationRun.createdAt,
		automationRun.startedAt,
		automationRun.finishedAt,
		context,
	);
}

export function getAutomationRun(db: MaliniDatabase, id: string): AutomationRunRecord | null {
	const row = get<AutomationRunRow>(db, `SELECT ${COLUMNS} FROM automation_runs WHERE id = ?`, id);
	return row ? fromRow(row) : null;
}

export function getAutomationRunContext(db: MaliniDatabase, id: string): string | null {
	return (
		get<{ context: string | null }>(db, 'SELECT context FROM automation_runs WHERE id = ?', id)
			?.context ?? null
	);
}

export function saveAutomationRun(db: MaliniDatabase, automationRun: AutomationRunRecord): void {
	run(
		db,
		`UPDATE automation_runs
		 SET workstream_id = ?, session_id = ?, agent_run_id = ?, status = ?, interrupted = ?,
		     detail = ?, requests = ?, started_at = ?, finished_at = ?
		 WHERE id = ?`,
		automationRun.workstreamId,
		automationRun.sessionId,
		automationRun.agentRunId,
		automationRun.status,
		automationRun.interrupted === true ? 1 : 0,
		automationRun.detail,
		automationRun.requests,
		automationRun.startedAt,
		automationRun.finishedAt,
		automationRun.id,
	);
}

export function appendAutomationRunContext(db: MaliniDatabase, id: string, context: string): void {
	run(db, 'UPDATE automation_runs SET context = ? WHERE id = ?', context, id);
}

export function findPendingAutomationRun(
	db: MaliniDatabase,
	definitionId: string,
	target: Pick<AutomationRunRecord, 'workstreamId' | 'repositoryId' | 'scope'>,
): AutomationRunRecord | null {
	const row = get<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs
		 WHERE definition_id = ? AND ${PENDING}
		   AND workstream_id IS ? AND repository_id IS ? AND scope IS ?
		   AND chat_session_id IS NULL AND origin NOT IN ('merge-queue', 'schedule')
		 ORDER BY created_at, rowid LIMIT 1`,
		definitionId,
		target.workstreamId,
		target.repositoryId,
		target.scope,
	);
	return row ? fromRow(row) : null;
}

export function countChainAutomationRuns(
	db: MaliniDatabase,
	chainId: string,
	definitionId: string,
	target: Pick<AutomationRunRecord, 'workstreamId' | 'repositoryId' | 'scope'>,
	origin: AutomationRunOrigin,
): number {
	return scalar(
		db,
		`SELECT COUNT(*) FROM automation_runs
		 WHERE chain_id = ? AND definition_id = ? AND status != 'cancelled'
		   AND (origin = 'merge-queue') = ?
		   AND workstream_id IS ? AND repository_id IS ? AND scope IS ?`,
		chainId,
		definitionId,
		origin === 'merge-queue' ? 1 : 0,
		target.workstreamId,
		target.repositoryId,
		target.scope,
	);
}

export function automationRunChainId(db: MaliniDatabase, id: string): string | null {
	return (
		get<{ chain_id: string }>(db, 'SELECT chain_id FROM automation_runs WHERE id = ?', id)
			?.chain_id ?? null
	);
}

export function workAutomationRunInWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
	finishedSince: string,
): AutomationRunRecord | null {
	const row = get<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs
		 WHERE workstream_id = ?
		   AND (${ACTIVE} OR (finished_at IS NOT NULL AND finished_at >= ?
		     AND started_at IS NOT NULL))
		 ORDER BY ${ACTIVE} DESC, COALESCE(finished_at, started_at) DESC
		 LIMIT 1`,
		workstreamId,
		finishedSince,
	);
	return row ? fromRow(row) : null;
}

export function listAutomationRunsSince(db: MaliniDatabase, since: string): AutomationRunRecord[] {
	return all<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs
		 WHERE created_at >= ? OR finished_at IS NULL OR finished_at >= ?
		 ORDER BY created_at, rowid`,
		since,
		since,
	).map(fromRow);
}

export function listUnfinishedAutomationRuns(db: MaliniDatabase): AutomationRunRecord[] {
	return all<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs WHERE ${UNFINISHED} ORDER BY created_at, rowid`,
	).map(fromRow);
}

export function listRecentFinishedAutomationRuns(
	db: MaliniDatabase,
	limit: number,
): AutomationRunRecord[] {
	return all<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs WHERE NOT ${UNFINISHED}
		 ORDER BY created_at DESC, rowid DESC LIMIT ?`,
		limit,
	).map(fromRow);
}

export function childAutomationRun(
	db: MaliniDatabase,
	parentRunId: string,
	definitionId: string,
): AutomationRunRecord | null {
	const row = get<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs WHERE parent_run_id = ? AND definition_id = ?
		 ORDER BY created_at, rowid LIMIT 1`,
		parentRunId,
		definitionId,
	);
	return row ? fromRow(row) : null;
}

export function findActiveAutomationRunForSession(
	db: MaliniDatabase,
	sessionId: string,
): AutomationRunRecord | null {
	const row = get<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs
		 WHERE session_id = ? AND ${ACTIVE}
		 ORDER BY created_at DESC LIMIT 1`,
		sessionId,
	);
	return row ? fromRow(row) : null;
}

export function countStartedOrQueuedAutomationRuns(
	db: MaliniDatabase,
	definitionId: string,
): number {
	return scalar(
		db,
		`SELECT COUNT(*) FROM automation_runs WHERE definition_id = ? AND ${STARTED_OR_QUEUED}`,
		definitionId,
	);
}

export function latestAutomationRunForSession(
	db: MaliniDatabase,
	sessionId: string,
): AutomationRunRecord | null {
	const row = get<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
		sessionId,
	);
	return row ? fromRow(row) : null;
}

export function latestWorkstreamAutomationRun(
	db: MaliniDatabase,
	workstreamId: string,
	definitionIds: readonly string[],
): AutomationRunRecord | null {
	const row = get<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs
		 WHERE workstream_id = ?
		   AND definition_id IN (SELECT value FROM json_each(?))
		 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
		workstreamId,
		JSON.stringify(definitionIds),
	);
	return row ? fromRow(row) : null;
}

export function activeWorkstreamAutomationRun(
	db: MaliniDatabase,
	workstreamId: string,
	definitionIds: readonly string[],
): AutomationRunRecord | null {
	const row = get<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs
		 WHERE workstream_id = ? AND ${UNFINISHED}
		   AND definition_id IN (SELECT value FROM json_each(?))
		 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
		workstreamId,
		JSON.stringify(definitionIds),
	);
	return row ? fromRow(row) : null;
}

export function latestScheduledAutomationRun(
	db: MaliniDatabase,
	definitionId: string,
): AutomationRunRecord | null {
	const row = get<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs WHERE definition_id = ? AND origin = 'schedule'
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
			`SELECT workstream_id FROM automation_runs
			 WHERE definition_id = ? AND origin = 'schedule' AND workstream_id IS NOT NULL
			 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
			definitionId,
		)?.workstream_id ?? null
	);
}

export function listUnfinishedRunsOfAutomation(
	db: MaliniDatabase,
	definitionId: string,
): AutomationRunRecord[] {
	return all<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs WHERE definition_id = ? AND ${UNFINISHED}
		 ORDER BY created_at, rowid`,
		definitionId,
	).map(fromRow);
}

export function listWaitingAutomationRuns(
	db: MaliniDatabase,
	definitionId: string,
): AutomationRunRecord[] {
	return all<AutomationRunRow>(
		db,
		`SELECT ${COLUMNS} FROM automation_runs WHERE definition_id = ? AND status = 'waiting'
		 ORDER BY created_at, rowid`,
		definitionId,
	).map(fromRow);
}

export function automationRunChainDefinitionIds(
	db: MaliniDatabase,
	automationRunId: string,
	maxDepth: number,
): string[] {
	return column(
		db,
		`WITH RECURSIVE chain(definition_id, parent_run_id, depth) AS (
		   SELECT definition_id, parent_run_id, 1 FROM automation_runs WHERE id = ?
		   UNION ALL
		   SELECT run.definition_id, run.parent_run_id, chain.depth + 1
		   FROM automation_runs AS run JOIN chain ON run.id = chain.parent_run_id
		   WHERE chain.depth < ?
		 )
		 SELECT definition_id FROM chain`,
		automationRunId,
		maxDepth,
	);
}
