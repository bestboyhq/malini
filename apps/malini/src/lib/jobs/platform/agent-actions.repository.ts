import {
	JOB_INTERRUPTED_DETAIL,
	type AgentActionApproval,
	type AgentActionRecord,
	type AgentActionStatus,
} from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, isRecord, parseJsonColumn, run } from '$main/db/rows';

export const AGENT_ACTIONS_SHOWN = 200;

interface AgentActionRow {
	id: string;
	session_id: string;
	run_id: string;
	workstream_id: string | null;
	tool: string;
	input_json: string;
	status: AgentActionStatus;
	approval: AgentActionApproval;
	output: string | null;
	started_at: string;
	finished_at: string | null;
}

const COLUMNS =
	'id, session_id, run_id, workstream_id, tool, input_json, status, approval, output, started_at, finished_at';

function actionFromRow(row: AgentActionRow): AgentActionRecord {
	const input = parseJsonColumn(row.input_json);
	return {
		id: row.id,
		sessionId: row.session_id,
		runId: row.run_id,
		workstreamId: row.workstream_id,
		tool: row.tool,
		input: isRecord(input) ? input : {},
		status: row.status,
		approval: row.approval,
		output: row.output,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

export function insertAgentAction(db: MaliniDatabase, action: AgentActionRecord): void {
	run(
		db,
		`INSERT INTO agent_actions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		action.id,
		action.sessionId,
		action.runId,
		action.workstreamId,
		action.tool,
		JSON.stringify(action.input),
		action.status,
		action.approval,
		action.output,
		action.startedAt,
		action.finishedAt,
	);
}

export function finishAgentActionRow(
	db: MaliniDatabase,
	id: string,
	status: Exclude<AgentActionStatus, 'running'>,
	output: string,
	finishedAt: string,
): AgentActionRecord | null {
	run(
		db,
		`UPDATE agent_actions SET status = ?, output = ?, finished_at = ? WHERE id = ? AND status = 'running'`,
		status,
		output,
		finishedAt,
		id,
	);
	const row = get<AgentActionRow>(db, `SELECT ${COLUMNS} FROM agent_actions WHERE id = ?`, id);
	return row ? actionFromRow(row) : null;
}

// ponytail: keeps every call forever and shows the latest AGENT_ACTIONS_SHOWN; prune by age once the table grows past what anyone reads
export function listAgentActions(db: MaliniDatabase): AgentActionRecord[] {
	return all<AgentActionRow>(
		db,
		`SELECT ${COLUMNS} FROM agent_actions ORDER BY started_at DESC, rowid DESC LIMIT ?`,
		AGENT_ACTIONS_SHOWN,
	).map(actionFromRow);
}

export function settleInterruptedAgentActions(db: MaliniDatabase, finishedAt: string): void {
	run(
		db,
		`UPDATE agent_actions SET status = 'failed', output = COALESCE(output, ?), finished_at = ?
		 WHERE status = 'running'`,
		JOB_INTERRUPTED_DETAIL,
		finishedAt,
	);
}
