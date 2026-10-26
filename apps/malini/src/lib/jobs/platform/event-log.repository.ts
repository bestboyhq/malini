import type { EventCause, EventCauseKind, LoggedEventRecord } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';

export type NewLoggedEvent = Readonly<{
	channel: string;
	payload: string;
	digest: string;
	workstreamId: string | null;
	cause: EventCause | null;
	chainId: string;
	emittedAt: string;
}>;

interface LoggedEventRow {
	id: number;
	channel: string;
	payload: string;
	workstream_id: string | null;
	cause_kind: EventCauseKind | null;
	cause_id: string | null;
	chain_id: string;
	emitted_at: string;
}

const COLUMNS = 'id, channel, payload, workstream_id, cause_kind, cause_id, chain_id, emitted_at';

function fromRow(row: LoggedEventRow, payloadLimit: number): LoggedEventRecord {
	return {
		id: row.id,
		channel: row.channel,
		payload: row.payload.length > payloadLimit ? null : parsed(row.payload),
		workstreamId: row.workstream_id,
		cause:
			row.cause_kind === null || row.cause_id === null
				? null
				: { kind: row.cause_kind, id: row.cause_id },
		chainId: row.chain_id,
		emittedAt: row.emitted_at,
	};
}

function parsed(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

export function insertLoggedEvent(db: MaliniDatabase, event: NewLoggedEvent): number {
	return run(
		db,
		`INSERT INTO event_log
		   (channel, payload, digest, workstream_id, cause_kind, cause_id, chain_id, emitted_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		event.channel,
		event.payload,
		event.digest,
		event.workstreamId,
		event.cause?.kind ?? null,
		event.cause?.id ?? null,
		event.chainId,
		event.emittedAt,
	).lastInsertRowid;
}

export function markEventHandled(db: MaliniDatabase, id: number, handledAt: string): void {
	run(db, 'UPDATE event_log SET handled_at = ? WHERE id = ?', handledAt, id);
}

export type UnhandledEvent = Readonly<{
	id: number;
	channel: string;
	payload: unknown;
	digest: string;
	chainId: string;
	cause: EventCause | null;
}>;

export function listUnhandledEvents(db: MaliniDatabase, since: string): UnhandledEvent[] {
	return all<LoggedEventRow & { digest: string }>(
		db,
		`SELECT ${COLUMNS}, digest FROM event_log
		 WHERE handled_at IS NULL AND emitted_at >= ? ORDER BY id`,
		since,
	).map((row) => ({ ...fromRow(row, Number.POSITIVE_INFINITY), digest: row.digest }));
}

export function pruneEventLog(db: MaliniDatabase, before: string): number {
	return db.transaction(() => {
		const pruned = run(db, 'DELETE FROM event_log WHERE emitted_at < ?', before).changes;
		run(db, 'DELETE FROM job_run_events WHERE event_id NOT IN (SELECT id FROM event_log)');
		return pruned;
	});
}

export function eventChainId(db: MaliniDatabase, id: number): string | null {
	return (
		get<{ chain_id: string }>(db, 'SELECT chain_id FROM event_log WHERE id = ?', id)?.chain_id ??
		null
	);
}

export function getLoggedEvent(db: MaliniDatabase, id: number): LoggedEventRecord | null {
	const row = get<LoggedEventRow>(db, `SELECT ${COLUMNS} FROM event_log WHERE id = ?`, id);
	return row ? fromRow(row, Number.POSITIVE_INFINITY) : null;
}

export function listLoggedEventsSince(
	db: MaliniDatabase,
	since: string,
	limit: number,
	payloadLimit: number,
): LoggedEventRecord[] {
	return all<LoggedEventRow>(
		db,
		`SELECT ${COLUMNS} FROM (
		   SELECT ${COLUMNS} FROM event_log WHERE emitted_at >= ? ORDER BY id DESC LIMIT ?
		 ) ORDER BY id`,
		since,
		limit,
	).map((row) => fromRow(row, payloadLimit));
}

export function triggeredBefore(
	db: MaliniDatabase,
	definitionId: string,
	channel: string,
	digest: string,
): boolean {
	return (
		get(
			db,
			`SELECT 1 FROM job_run_events link
			 JOIN event_log event ON event.id = link.event_id
			 JOIN job_runs run ON run.id = link.job_run_id
			 WHERE run.definition_id = ? AND event.channel = ? AND event.digest = ?
			 LIMIT 1`,
			definitionId,
			channel,
			digest,
		) !== null
	);
}

export function linkJobRunEvent(db: MaliniDatabase, jobRunId: string, eventId: number): void {
	run(
		db,
		'INSERT OR IGNORE INTO job_run_events (job_run_id, event_id) VALUES (?, ?)',
		jobRunId,
		eventId,
	);
}

export function jobRunEventIds(
	db: MaliniDatabase,
	jobRunIds: readonly string[],
): Map<string, number[]> {
	const links = new Map<string, number[]>();
	for (const row of all<{ job_run_id: string; event_id: number }>(
		db,
		`SELECT job_run_id, event_id FROM job_run_events
		 WHERE job_run_id IN (SELECT value FROM json_each(?)) ORDER BY event_id`,
		JSON.stringify(jobRunIds),
	)) {
		const ids = links.get(row.job_run_id) ?? [];
		ids.push(row.event_id);
		links.set(row.job_run_id, ids);
	}
	return links;
}
