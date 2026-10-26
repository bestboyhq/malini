import type { AgentRunProfile } from '$contract/agent';
import type { ChatTurnRecord, TimelineChatTurn } from '$contract/jobs';
import {
	nextSessionStatus,
	PAUSED_FOR_EXIT_ERROR,
	type SessionStatus,
} from '$contract/agent-state-machine';
import type { MaliniDatabase } from '$main/db/driver';
import { closeTerminalInteractions } from './interactions.repository';
import { invariant } from '$main/errors';
import { all, column, get, run, scalar } from '$main/db/rows';

export interface AgentRun {
	id: string;
	sessionId: string;
	prompt: string;
	startedAt: string;
	completedAt: string | null;
	summary: string | null;
	error: string | null;
	automated?: boolean;
	profile?: AgentRunProfile;
	chainId?: string;
	causeEventId?: number;
}

export type TerminalRunStatus = 'completed' | 'failed';

interface RunRow {
	id: string;
	session_id: string;
	prompt: string;
	started_at: string;
	completed_at: string | null;
	summary: string | null;
	error: string | null;
}

function runFromRow(row: RunRow): AgentRun {
	return {
		id: row.id,
		sessionId: row.session_id,
		prompt: row.prompt,
		startedAt: row.started_at,
		completedAt: row.completed_at,
		summary: row.summary,
		error: row.error,
	};
}

export function insertRun(db: MaliniDatabase, agentRun: AgentRun): void {
	const { changes } = run(
		db,
		`INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, summary, error, automated, profile, chain_id, cause_event_id)
		 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
		 WHERE EXISTS (SELECT 1 FROM agent_sessions WHERE id = ? AND archived_at IS NULL)`,
		agentRun.id,
		agentRun.sessionId,
		agentRun.prompt,
		agentRun.startedAt,
		agentRun.completedAt,
		agentRun.summary,
		agentRun.error,
		agentRun.automated === true ? 1 : 0,
		agentRun.profile ? JSON.stringify(agentRun.profile) : null,
		agentRun.chainId ?? '',
		agentRun.causeEventId ?? null,
		agentRun.sessionId,
	);
	if (changes !== 1) {
		throw invariant(
			`cannot start run \`${agentRun.id}\` for missing or archived agent session \`${agentRun.sessionId}\``,
		);
	}
}

export function insertRunForWorkstream(
	db: MaliniDatabase,
	agentRun: AgentRun,
	workstreamId: string,
): void {
	const { changes } = run(
		db,
		`INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, summary, error, automated, profile, chain_id, cause_event_id)
		 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
		 WHERE EXISTS (
		   SELECT 1 FROM agent_sessions
		   WHERE id = ? AND workstream_id = ? AND archived_at IS NULL
		 )`,
		agentRun.id,
		agentRun.sessionId,
		agentRun.prompt,
		agentRun.startedAt,
		agentRun.completedAt,
		agentRun.summary,
		agentRun.error,
		agentRun.automated === true ? 1 : 0,
		agentRun.profile ? JSON.stringify(agentRun.profile) : null,
		agentRun.chainId ?? '',
		agentRun.causeEventId ?? null,
		agentRun.sessionId,
		workstreamId,
	);
	if (changes !== 1) {
		throw invariant(
			`cannot start run \`${agentRun.id}\` for a missing, archived, or foreign agent session`,
		);
	}
}

export function getRun(db: MaliniDatabase, runId: string): AgentRun | null {
	const row = get<RunRow>(
		db,
		'SELECT id, session_id, prompt, started_at, completed_at, summary, error FROM agent_runs WHERE id = ?',
		runId,
	);
	return row ? runFromRow(row) : null;
}

export function storedRunProfile(db: MaliniDatabase, runId: string): unknown {
	const row = get<{ profile: string | null }>(
		db,
		'SELECT profile FROM agent_runs WHERE id = ?',
		runId,
	);
	return row?.profile ? JSON.parse(row.profile) : null;
}

export function getWorkstreamRun(
	db: MaliniDatabase,
	workstreamId: string,
	runId: string,
): AgentRun | null {
	const row = get<RunRow>(
		db,
		`SELECT r.id, r.session_id, r.prompt, r.started_at, r.completed_at, r.summary, r.error
		 FROM agent_runs r JOIN agent_sessions s ON s.id = r.session_id
		 WHERE r.id = ? AND s.workstream_id = ?`,
		runId,
		workstreamId,
	);
	return row ? runFromRow(row) : null;
}

export function getRunWorkstreamId(db: MaliniDatabase, runId: string): string | null {
	return (
		get<{ workstream_id: string }>(
			db,
			`SELECT s.workstream_id FROM agent_runs r JOIN agent_sessions s ON s.id = r.session_id
			 WHERE r.id = ?`,
			runId,
		)?.workstream_id ?? null
	);
}

export function recordOpenTurnReply(db: MaliniDatabase, runId: string, reply: string | null): void {
	run(db, 'UPDATE agent_runs SET summary = ? WHERE id = ? AND completed_at IS NULL', reply, runId);
}

export function openTurnReply(db: MaliniDatabase, runId: string): string | null {
	return (
		get<{ summary: string | null }>(
			db,
			'SELECT summary FROM agent_runs WHERE id = ? AND completed_at IS NULL',
			runId,
		)?.summary ?? null
	);
}

export function finalizeRunLifecycle(
	db: MaliniDatabase,
	sessionId: string,
	runId: string,
	status: TerminalRunStatus,
	summary: string | null,
	error: string | null,
	completedAt: string,
): number {
	if (status !== 'completed' && status !== 'failed') {
		throw invariant(`terminal run status \`${String(status)}\` is invalid`);
	}
	return db.transaction(() => {
		const { changes } = run(
			db,
			`UPDATE agent_runs SET completed_at = ?, summary = ?, error = ?
			 WHERE id = ? AND session_id = ? AND completed_at IS NULL`,
			completedAt,
			summary,
			error,
			runId,
			sessionId,
		);
		if (changes === 0) {
			const exists = scalar(
				db,
				'SELECT COUNT(*) FROM agent_runs WHERE id = ? AND session_id = ?',
				runId,
				sessionId,
			);
			if (exists !== 1) {
				throw invariant(`cannot finalize missing run \`${runId}\` for session \`${sessionId}\``);
			}
		}
		const closedInteractions = closeTerminalInteractions(db, sessionId, runId, completedAt);
		if (changes === 1) {
			const current = get<{ status: SessionStatus }>(
				db,
				'SELECT status FROM agent_sessions WHERE id = ?',
				sessionId,
			);
			if (!current) {
				throw invariant(`cannot finalize run \`${runId}\` for missing session \`${sessionId}\``);
			}
			const kind = status === 'completed' ? 'run.completed' : 'run.failed';
			const next = nextSessionStatus(current.status, kind, error);
			if (next === 'invalid') {
				throw invariant(
					`session \`${sessionId}\` cannot move from \`${current.status}\` on \`${kind}\``,
				);
			}
			run(
				db,
				`UPDATE agent_sessions SET status = ? WHERE id = ?
				 AND NOT EXISTS (SELECT 1 FROM agent_runs
				   WHERE session_id = ? AND completed_at IS NULL)`,
				next,
				sessionId,
				sessionId,
			);
		}
		return closedInteractions;
	});
}

export function workstreamHasOpenRun(db: MaliniDatabase, workstreamId: string): boolean {
	return (
		scalar(
			db,
			`SELECT COUNT(*) FROM agent_runs r
			 JOIN agent_sessions s ON s.id = r.session_id
			 WHERE s.workstream_id = ? AND r.completed_at IS NULL`,
			workstreamId,
		) > 0
	);
}

export function listOpenRunIds(db: MaliniDatabase): string[] {
	return column(
		db,
		'SELECT id FROM agent_runs WHERE completed_at IS NULL ORDER BY started_at ASC, id ASC',
	);
}

export interface PausedRun {
	runId: string;
	sessionId: string;
	workstreamId: string;
	profile: unknown;
}

export function listPausedRuns(db: MaliniDatabase): PausedRun[] {
	return all<{ id: string; session_id: string; workstream_id: string; profile: string | null }>(
		db,
		`SELECT r.id, r.session_id, s.workstream_id, r.profile FROM agent_runs r
		 JOIN agent_sessions s ON s.id = r.session_id
		 WHERE r.error = ? AND r.obsoleted_at IS NULL AND s.archived_at IS NULL
		   AND r.rowid = (SELECT MAX(rowid) FROM agent_runs WHERE session_id = r.session_id)
		 ORDER BY r.started_at ASC`,
		PAUSED_FOR_EXIT_ERROR,
	).map((row) => ({
		runId: row.id,
		sessionId: row.session_id,
		workstreamId: row.workstream_id,
		profile: row.profile === null ? null : JSON.parse(row.profile),
	}));
}

export function listOpenRuns(db: MaliniDatabase): Array<{ id: string; sessionId: string }> {
	return all<{ id: string; session_id: string }>(
		db,
		'SELECT id, session_id FROM agent_runs WHERE completed_at IS NULL ORDER BY started_at ASC, id ASC',
	).map((row) => ({ id: row.id, sessionId: row.session_id }));
}

export function activeRunWorkstreamIdentity(
	db: MaliniDatabase,
	sessionId: string,
	runId: string,
): { workstreamId: string; path: string } | null {
	const row = get<{ id: string; path: string }>(
		db,
		`SELECT w.id, w.path FROM agent_runs r
		 JOIN agent_sessions s ON s.id = r.session_id
		 JOIN workstreams w ON w.id = s.workstream_id
		 WHERE r.id = ? AND r.session_id = ? AND r.completed_at IS NULL
		   AND s.archived_at IS NULL`,
		runId,
		sessionId,
	);
	return row ? { workstreamId: row.id, path: row.path } : null;
}

export interface RunActivity {
	readonly date: string;
	readonly projectId: string;
	readonly runs: number;
	readonly jobRuns: number;
	readonly seconds: number;
}

export function listRunActivity(db: MaliniDatabase): RunActivity[] {
	return all<{
		date: string;
		project_id: string;
		runs: number;
		job_runs: number;
		seconds: number;
	}>(
		db,
		`SELECT date(r.started_at, 'localtime') AS date, w.project_id,
		        COUNT(*) AS runs,
		        SUM(s.origin = 'job') AS job_runs,
		        COALESCE(SUM((julianday(r.completed_at) - julianday(r.started_at)) * 86400), 0) AS seconds
		 FROM agent_runs r
		 JOIN agent_sessions s ON s.id = r.session_id
		 JOIN workstreams w ON w.id = s.workstream_id
		 GROUP BY date, w.project_id
		 ORDER BY date ASC`,
	).map((row) => ({
		date: row.date,
		projectId: row.project_id,
		runs: row.runs,
		jobRuns: row.job_runs,
		seconds: row.seconds,
	}));
}

const CHAT_TURN_PROMPT_CHARS = 300;

interface ChatTurnRow {
	id: string;
	session_id: string;
	workstream_id: string;
	display_name: string;
	prompt: string;
	chain_id: string;
	cause_event_id: number | null;
	started_at: string;
	completed_at: string | null;
	error: string | null;
}

function chatTurnFromRow(row: ChatTurnRow): ChatTurnRecord {
	return {
		runId: row.id,
		sessionId: row.session_id,
		workstreamId: row.workstream_id,
		chatName: row.display_name,
		prompt: firstLine(row.prompt).slice(0, CHAT_TURN_PROMPT_CHARS),
		status: row.completed_at === null ? 'running' : row.error === null ? 'succeeded' : 'failed',
		chainId: row.chain_id || row.id,
		causeEventId: row.cause_event_id,
		startedAt: row.started_at,
		finishedAt: row.completed_at,
	};
}

export function listChatTurns(
	db: MaliniDatabase,
	runIds: readonly string[],
	latest: number,
): ChatTurnRecord[] {
	return all<ChatTurnRow>(
		db,
		`SELECT r.id, r.session_id, s.workstream_id, s.display_name, r.prompt, r.chain_id,
		        r.cause_event_id, r.started_at, r.completed_at, r.error
		 FROM agent_runs r JOIN agent_sessions s ON s.id = r.session_id
		 WHERE s.origin = 'user' AND r.obsoleted_at IS NULL
		   AND (r.id IN (SELECT value FROM json_each(?))
		     OR r.id IN (SELECT latest.id FROM agent_runs latest
		                 JOIN agent_sessions owner ON owner.id = latest.session_id
		                 WHERE owner.origin = 'user' AND latest.obsoleted_at IS NULL
		                 ORDER BY latest.started_at DESC LIMIT ?))
		 ORDER BY r.started_at DESC`,
		JSON.stringify(runIds),
		latest,
	).map(chatTurnFromRow);
}

export function listChatTurnsSince(db: MaliniDatabase, since: string): TimelineChatTurn[] {
	return all<ChatTurnRow & { sender: string | null }>(
		db,
		`SELECT r.id, r.session_id, s.workstream_id, s.display_name, r.prompt, r.chain_id,
		        r.cause_event_id, r.started_at, r.completed_at, r.error,
		        (SELECT CASE WHEN json_valid(substr(e.event, instr(e.event, char(10)) + 1))
		                THEN json_extract(substr(e.event, instr(e.event, char(10)) + 1), '$.from') END
		         FROM agent_events e
		         WHERE e.run_id = r.id AND e.event LIKE 'user.message' || char(10) || '%'
		         ORDER BY e.seq LIMIT 1) AS sender
		 FROM agent_runs r JOIN agent_sessions s ON s.id = r.session_id
		 WHERE s.origin = 'user' AND r.obsoleted_at IS NULL
		   AND (r.started_at >= ? OR r.completed_at IS NULL OR r.completed_at >= ?)
		 ORDER BY r.started_at`,
		since,
		since,
	).map((row) => ({ ...chatTurnFromRow(row), from: row.sender }));
}

export type ChatTurnWork = Readonly<{ runId: string; sessionId: string; chainId: string }>;

export function workChatTurnInWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
	finishedSince: string,
): ChatTurnWork | null {
	const row = get<{ id: string; session_id: string; chain_id: string }>(
		db,
		`SELECT r.id, r.session_id, r.chain_id
		 FROM agent_runs r JOIN agent_sessions s ON s.id = r.session_id
		 WHERE s.workstream_id = ? AND r.obsoleted_at IS NULL
		   AND (r.completed_at IS NULL OR r.completed_at >= ?)
		 ORDER BY r.completed_at IS NULL DESC, COALESCE(r.completed_at, r.started_at) DESC
		 LIMIT 1`,
		workstreamId,
		finishedSince,
	);
	return row ? { runId: row.id, sessionId: row.session_id, chainId: row.chain_id || row.id } : null;
}

export function chatTurnChainId(db: MaliniDatabase, runId: string): string | null {
	const row = get<{ id: string; chain_id: string }>(
		db,
		'SELECT id, chain_id FROM agent_runs WHERE id = ?',
		runId,
	);
	return row ? row.chain_id || row.id : null;
}

export function chatTurnSessionId(db: MaliniDatabase, runId: string): string | null {
	return (
		get<{ session_id: string }>(db, 'SELECT session_id FROM agent_runs WHERE id = ?', runId)
			?.session_id ?? null
	);
}

function firstLine(text: string): string {
	return (
		text
			.split('\n')
			.map((line) => line.trim())
			.find(Boolean) ?? ''
	);
}
