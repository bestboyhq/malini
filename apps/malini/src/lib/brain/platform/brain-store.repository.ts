import type { MaliniDatabase } from '$main/db/driver';
import { all, get, nowIso8601, run, scalar } from '$main/db/rows';

export type BrainSettingName =
	| 'repository-id'
	| 'workstream-id'
	| 'sync'
	| 'since-seq'
	| 'synced-at'
	| 'problem'
	| 'caught-up-on';

export function brainSetting(db: MaliniDatabase, name: BrainSettingName): string | null {
	return (
		get<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', `brain.${name}`)
			?.value ?? null
	);
}

export function saveBrainSetting(
	db: MaliniDatabase,
	name: BrainSettingName,
	value: string | null,
): void {
	if (value === null) {
		run(db, 'DELETE FROM settings WHERE key = ?', `brain.${name}`);
		return;
	}
	run(
		db,
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
		`brain.${name}`,
		value,
	);
}

export function latestEventSeq(db: MaliniDatabase): number {
	return scalar(db, 'SELECT COALESCE(MAX(seq), 0) FROM agent_events');
}

export function saveCapturedSeq(db: MaliniDatabase, sessionId: string, lastSeq: number): void {
	run(
		db,
		`INSERT INTO brain_captures (session_id, last_seq, captured_at) VALUES (?, ?, ?)
		 ON CONFLICT (session_id) DO UPDATE SET
		   last_seq = MAX(brain_captures.last_seq, excluded.last_seq),
		   captured_at = excluded.captured_at`,
		sessionId,
		lastSeq,
		nowIso8601(),
	);
}

export type TypedPromptRow = Readonly<{
	seq: number;
	sessionId: string;
	runId: string;
	event: string;
	workstreamId: string;
	chatName: string;
	scope: string | null;
	summary: string | null;
	completedAt: string | null;
}>;

export function uncapturedPrompts(
	db: MaliniDatabase,
	brainProjectId: string | null,
	sinceSeq: number,
): TypedPromptRow[] {
	return all<{
		seq: number;
		session_id: string;
		run_id: string;
		event: string;
		workstream_id: string;
		display_name: string;
		scope: string | null;
		summary: string | null;
		completed_at: string | null;
	}>(
		db,
		`SELECT e.seq, e.session_id, e.run_id, e.event, s.workstream_id, s.display_name, w.scope,
		        r.summary, r.completed_at
		 FROM agent_sessions s
		 JOIN workstreams w ON w.id = s.workstream_id
		 JOIN agent_events e ON e.session_id = s.id
		 JOIN agent_runs r ON r.id = e.run_id
		 LEFT JOIN brain_captures c ON c.session_id = s.id
		 WHERE s.origin = 'user'
		   AND (w.status = 'archived' OR w.scope IS NOT NULL)
		   AND w.project_id IS NOT ?
		   AND e.seq > MAX(COALESCE(c.last_seq, 0), ?)
		   AND e.event LIKE 'user.message' || char(10) || '%'
		   AND r.automated = 0
		   AND r.obsoleted_at IS NULL
		 ORDER BY e.seq`,
		brainProjectId,
		sinceSeq,
	).map((row) => ({
		seq: row.seq,
		sessionId: row.session_id,
		runId: row.run_id,
		event: row.event,
		workstreamId: row.workstream_id,
		chatName: row.display_name,
		scope: row.scope,
		summary: row.summary,
		completedAt: row.completed_at,
	}));
}
