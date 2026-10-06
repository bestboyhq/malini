import { nextSessionStatus, type SessionStatus } from '$contract/agent-state-machine';
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
		`INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, summary, error, automated)
		 SELECT ?, ?, ?, ?, ?, ?, ?, ?
		 WHERE EXISTS (SELECT 1 FROM agent_sessions WHERE id = ? AND archived_at IS NULL)`,
		agentRun.id,
		agentRun.sessionId,
		agentRun.prompt,
		agentRun.startedAt,
		agentRun.completedAt,
		agentRun.summary,
		agentRun.error,
		agentRun.automated === true ? 1 : 0,
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
		`INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, summary, error, automated)
		 SELECT ?, ?, ?, ?, ?, ?, ?, ?
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
