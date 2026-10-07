import {
	foldSessionStatus,
	isLifecycleKind,
	type LifecycleEnvelope,
	type SessionStatus,
} from '$contract/agent-state-machine';
import { listEventRowsForSession } from './events.repository';
import { promptChipSegments } from '$lib/chat/domain/prompt-chip';
import type { MaliniDatabase } from '$main/db/driver';
import { invariant } from '$main/errors';
import { all, column, get, run, scalar } from '$main/db/rows';
import type { AgentSessionSummary } from '$contract/agent';
import { deriveAgentChatDisplayName } from '$contract/chat-identity';

export type { AgentSessionSummary };

export type { SessionStatus };

export interface AgentSession {
	id: string;
	workstreamId: string;
	model: string | null;
	providerSessionId: string | null;
	status: SessionStatus;
	startedAt: string;
}

export interface AgentSessionRecord extends AgentSession {
	displayName: string;
	archivedAt: string | null;
}

interface SessionRow {
	id: string;
	workstream_id: string;
	model: string | null;
	provider_session_id: string | null;
	status: SessionStatus;
	started_at: string;
	display_name: string;
	archived_at: string | null;
}

export function promptPlainText(prompt: string): string {
	return promptChipSegments(prompt)
		.map((segment) => (segment.kind === 'text' ? segment.text : ' '))
		.join('');
}

export function conciseSessionTitle(prompt: string): string | null {
	return deriveAgentChatDisplayName(promptPlainText(prompt));
}

function uniqueSessionDisplayName(
	db: MaliniDatabase,
	workstreamId: string,
	baseName: string,
	excludedSessionId: string | null,
): string {
	let candidate = baseName;
	let suffix = 2;
	for (;;) {
		const duplicates = scalar(
			db,
			`SELECT COUNT(*) FROM agent_sessions
			 WHERE workstream_id = ? AND archived_at IS NULL AND lower(display_name) = lower(?)
			 AND (? IS NULL OR id != ?)`,
			workstreamId,
			candidate,
			excludedSessionId,
			excludedSessionId,
		);
		if (duplicates === 0) return candidate;
		candidate = `${baseName} ${suffix}`;
		suffix += 1;
	}
}

const NEW_CHAT_NAME = 'New chat';

function chatOrdinalName(db: MaliniDatabase, workstreamId: string, sessionId: string): string {
	const ordinal = scalar(
		db,
		`SELECT COUNT(*) FROM agent_sessions
		 WHERE workstream_id = ? AND rowid <= (SELECT rowid FROM agent_sessions WHERE id = ?)`,
		workstreamId,
		sessionId,
	);
	return `Chat ${ordinal || 1}`;
}

function sessionFromRow(row: SessionRow): AgentSessionRecord {
	return {
		id: row.id,
		workstreamId: row.workstream_id,
		model: row.model,
		providerSessionId: row.provider_session_id,
		status: row.status,
		startedAt: row.started_at,
		displayName: row.display_name,
		archivedAt: row.archived_at,
	};
}

const SESSION_COLUMNS =
	'id, workstream_id, model, provider_session_id, status, started_at, display_name, archived_at';

export function insertSession(db: MaliniDatabase, session: AgentSession): void {
	const fallbackName = uniqueSessionDisplayName(db, session.workstreamId, NEW_CHAT_NAME, null);
	run(
		db,
		`INSERT INTO agent_sessions
		 (id, workstream_id, model, provider_session_id, status, started_at, display_name)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		session.id,
		session.workstreamId,
		session.model,
		session.providerSessionId,
		session.status,
		session.startedAt,
		fallbackName,
	);
}

export function getSession(db: MaliniDatabase, sessionId: string): AgentSessionRecord | null {
	const row = get<SessionRow>(
		db,
		`SELECT ${SESSION_COLUMNS} FROM agent_sessions WHERE id = ?`,
		sessionId,
	);
	return row ? sessionFromRow(row) : null;
}

export function discardUnregisteredSession(db: MaliniDatabase, sessionId: string): void {
	db.transaction(() => {
		run(db, 'DELETE FROM agent_events WHERE session_id = ?', sessionId);
		run(db, 'DELETE FROM agent_runs WHERE session_id = ?', sessionId);
		run(db, 'DELETE FROM agent_sessions WHERE id = ?', sessionId);
	});
}

export function archiveSession(db: MaliniDatabase, sessionId: string, archivedAt: string): void {
	db.transaction(() => {
		const existing = get<{ archived_at: string | null }>(
			db,
			'SELECT archived_at FROM agent_sessions WHERE id = ?',
			sessionId,
		);
		if (!existing) throw invariant(`agent session \`${sessionId}\` was not found`);
		if (existing.archived_at !== null) return;

		const openRuns = scalar(
			db,
			'SELECT COUNT(*) FROM agent_runs WHERE session_id = ? AND completed_at IS NULL',
			sessionId,
		);
		if (openRuns > 0) {
			throw invariant(`cannot archive agent session \`${sessionId}\` while a run is active`);
		}
		const { changes } = run(
			db,
			'UPDATE agent_sessions SET archived_at = ? WHERE id = ? AND archived_at IS NULL',
			archivedAt,
			sessionId,
		);
		if (changes !== 1) {
			throw invariant(`expected one active agent session \`${sessionId}\`, archived ${changes}`);
		}
		run(
			db,
			`UPDATE agent_permission_rules SET revoked_at = COALESCE(revoked_at, ?)
			 WHERE scope = 'session' AND session_id = ?`,
			archivedAt,
			sessionId,
		);
	});
}

export function ensureSessionDisplayNames(db: MaliniDatabase, workstreamId: string): void {
	const missing = column(
		db,
		`SELECT id FROM agent_sessions
		 WHERE workstream_id = ? AND trim(display_name) = '' ORDER BY rowid ASC`,
		workstreamId,
	);
	for (const sessionId of missing) {
		const firstPrompt = get<{ prompt: string }>(
			db,
			'SELECT prompt FROM agent_runs WHERE session_id = ? AND automated = 0 ORDER BY rowid ASC LIMIT 1',
			sessionId,
		);
		const baseName = firstPrompt
			? (conciseSessionTitle(firstPrompt.prompt) ?? chatOrdinalName(db, workstreamId, sessionId))
			: NEW_CHAT_NAME;
		const displayName = uniqueSessionDisplayName(db, workstreamId, baseName, sessionId);
		run(db, 'UPDATE agent_sessions SET display_name = ? WHERE id = ?', displayName, sessionId);
	}
}

export function sessionHasUserRun(db: MaliniDatabase, sessionId: string): boolean {
	return (
		scalar(
			db,
			'SELECT COUNT(*) FROM agent_runs WHERE session_id = ? AND automated = 0',
			sessionId,
		) > 0
	);
}

export function nameSession(
	db: MaliniDatabase,
	sessionId: string,
	workstreamId: string,
	title: string | null,
): string {
	const baseName = title ?? chatOrdinalName(db, workstreamId, sessionId);
	const displayName = uniqueSessionDisplayName(db, workstreamId, baseName, sessionId);
	run(db, 'UPDATE agent_sessions SET display_name = ? WHERE id = ?', displayName, sessionId);
	return displayName;
}

export function setProviderSessionId(
	db: MaliniDatabase,
	sessionId: string,
	providerSessionId: string,
): void {
	run(
		db,
		'UPDATE agent_sessions SET provider_session_id = ? WHERE id = ?',
		providerSessionId,
		sessionId,
	);
}

export function sessionContextIdentity(
	db: MaliniDatabase,
	sessionId: string,
): { workstreamId: string; displayName: string } | null {
	const row = get<{ workstream_id: string; display_name: string }>(
		db,
		'SELECT workstream_id, display_name FROM agent_sessions WHERE id = ?',
		sessionId,
	);
	return row ? { workstreamId: row.workstream_id, displayName: row.display_name } : null;
}

export function agentSessionBelongsToWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
	sessionId: string,
): boolean {
	return (
		scalar(
			db,
			`SELECT EXISTS(
			   SELECT 1 FROM agent_sessions s
			   JOIN workstreams w ON w.id = s.workstream_id
			   WHERE s.id = ? AND s.workstream_id = ?
			 )`,
			sessionId,
			workstreamId,
		) === 1
	);
}

export function listSessionSummaries(
	db: MaliniDatabase,
	workstreamId: string,
): AgentSessionSummary[] {
	return all<{
		id: string;
		workstream_id: string;
		display_name: string;
		model: string | null;
		projected_status: SessionStatus;
		started_at: string;
	}>(
		db,
		`SELECT s.id, s.workstream_id, s.display_name, s.model,
		        COALESCE((
		            SELECT CASE
		                WHEN r.completed_at IS NULL THEN
		                    CASE WHEN s.status = 'waiting_for_approval'
		                        THEN 'waiting_for_approval' ELSE 'running' END
		                WHEN r.error IS NOT NULL THEN 'failed'
		                ELSE 'completed'
		            END
		            FROM agent_runs r
		            WHERE r.session_id = s.id
		            ORDER BY r.rowid DESC
		            LIMIT 1
		        ), s.status) AS projected_status,
		        s.started_at
		 FROM agent_sessions s
		 WHERE s.workstream_id = ? AND s.archived_at IS NULL ORDER BY s.rowid DESC`,
		workstreamId,
	).map((row) => ({
		id: row.id,
		workstreamId: row.workstream_id,
		displayName: row.display_name,
		model: row.model,
		status: row.projected_status,
		startedAt: row.started_at,
	}));
}

export function repairSessionStatusesWithoutOpenRuns(
	db: MaliniDatabase,
	workstreamId: string,
): number {
	const stale = all<{ id: string }>(
		db,
		`SELECT id FROM agent_sessions
		 WHERE workstream_id = ?
		   AND archived_at IS NULL
		   AND status IN ('running', 'waiting_for_approval')
		   AND NOT EXISTS (
		     SELECT 1 FROM agent_runs
		     WHERE agent_runs.session_id = agent_sessions.id
		       AND agent_runs.completed_at IS NULL
		   )`,
		workstreamId,
	);
	let repaired = 0;
	for (const session of stale) {
		const events: LifecycleEnvelope[] = listEventRowsForSession(db, session.id, 0)
			.filter((row) => isLifecycleKind(row.kind))
			.map((row) => {
				const payload = row.payload;
				const error =
					payload !== null && typeof payload === 'object'
						? Reflect.get(payload, 'error')
						: undefined;
				return {
					runId: row.runId,
					event: error === undefined ? { type: row.kind } : { type: row.kind, error },
				};
			});
		const folded = foldSessionStatus('idle', events);
		repaired += run(
			db,
			'UPDATE agent_sessions SET status = ? WHERE id = ?',
			folded.status,
			session.id,
		).changes;
	}
	return repaired;
}

export function latestSessionForWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
): { id: string; model: string | null; providerSessionId: string | null } | null {
	const row = get<{ id: string; model: string | null; provider_session_id: string | null }>(
		db,
		`SELECT id, model, provider_session_id FROM agent_sessions
		 WHERE workstream_id = ? AND archived_at IS NULL
		 ORDER BY rowid DESC LIMIT 1`,
		workstreamId,
	);
	return row ? { id: row.id, model: row.model, providerSessionId: row.provider_session_id } : null;
}

export function setSessionModel(db: MaliniDatabase, sessionId: string, model: string | null): void {
	run(db, 'UPDATE agent_sessions SET model = ? WHERE id = ?', model, sessionId);
}

export function setSessionStatus(
	db: MaliniDatabase,
	sessionId: string,
	status: SessionStatus,
): void {
	run(db, 'UPDATE agent_sessions SET status = ? WHERE id = ?', status, sessionId);
}
