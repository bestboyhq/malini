import type { MaliniDatabase } from '$main/db/driver';
import { invariant } from '$main/errors';
import { all, get, isRecord, nowIso8601, run } from '$main/db/rows';
import type { AgentEventEnvelope } from '$contract/agent';

export type { AgentEventEnvelope };

export interface AgentEvent {
	kind: string;
	payload: unknown;
}

export interface AgentEventRow extends AgentEvent {
	seq: number;
	runId: string;
}

export function encodeEvent(kind: string, payloadJson: string): string {
	return `${kind}\n${payloadJson}`;
}

export function decodeEvent(blob: string): { kind: string; payloadJson: string } {
	const index = blob.indexOf('\n');
	if (index === -1) return { kind: blob, payloadJson: '' };
	return { kind: blob.slice(0, index), payloadJson: blob.slice(index + 1) };
}

function parsePayload(payloadJson: string): unknown {
	try {
		const parsed: unknown = JSON.parse(payloadJson);
		return parsed;
	} catch {
		return payloadJson;
	}
}

function eventFromBlob(blob: string): AgentEvent {
	const { kind, payloadJson } = decodeEvent(blob);
	return { kind, payload: parsePayload(payloadJson) };
}

export function appendEvent(
	db: MaliniDatabase,
	sessionId: string,
	runId: string,
	kind: string,
	payload: unknown,
): number {
	const combined = encodeEvent(kind, JSON.stringify(payload ?? {}));
	return run(
		db,
		'INSERT INTO agent_events (session_id, run_id, event, emitted_at) VALUES (?, ?, ?, ?)',
		sessionId,
		runId,
		combined,
		nowIso8601(),
	).lastInsertRowid;
}

export function updateEventPayload(
	db: MaliniDatabase,
	sessionId: string,
	seq: number,
	kind: string,
	payload: unknown,
): void {
	const combined = encodeEvent(kind, JSON.stringify(payload ?? {}));
	const { changes } = run(
		db,
		'UPDATE agent_events SET event = ? WHERE session_id = ? AND seq = ?',
		combined,
		sessionId,
		seq,
	);
	if (changes !== 1) {
		throw invariant(
			`expected one agent event for session \`${sessionId}\` seq ${seq}, updated ${changes}`,
		);
	}
}

export function listEventsForSession(
	db: MaliniDatabase,
	sessionId: string,
	sinceEventId: number,
): AgentEvent[] {
	return all<{ event: string }>(
		db,
		'SELECT event FROM agent_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC',
		sessionId,
		sinceEventId,
	).map((row) => eventFromBlob(row.event));
}

export function listEventRowsForSession(
	db: MaliniDatabase,
	sessionId: string,
	afterSeq: number,
): AgentEventRow[] {
	return all<{ seq: number; run_id: string; event: string }>(
		db,
		'SELECT seq, run_id, event FROM agent_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC',
		sessionId,
		afterSeq,
	).map((row) => ({ seq: row.seq, runId: row.run_id, ...eventFromBlob(row.event) }));
}

export function listRecentRunEventRowsForSession(
	db: MaliniDatabase,
	sessionId: string,
	byteBudget: number,
): AgentEventRow[] {
	return all<{ seq: number; run_id: string; event: string }>(
		db,
		`WITH runs AS (
			SELECT run_id, MIN(seq) AS first_seq, SUM(LENGTH(event)) AS bytes
			FROM agent_events WHERE session_id = ? GROUP BY run_id
		), tail AS (
			SELECT first_seq, SUM(bytes) OVER (ORDER BY first_seq DESC) AS tail_bytes FROM runs
		)
		SELECT seq, run_id, event FROM agent_events
		WHERE session_id = ? AND seq >= (SELECT MIN(first_seq) FROM tail WHERE tail_bytes <= ?)
		ORDER BY seq ASC`,
		sessionId,
		sessionId,
		Math.max(0, Math.floor(byteBudget)),
	).map((row) => ({ seq: row.seq, runId: row.run_id, ...eventFromBlob(row.event) }));
}

export type ProviderResumePoint =
	{ readonly resumeAt: string } | { readonly freshConversation: true } | Record<string, never>;

export function providerResumePoint(db: MaliniDatabase, sessionId: string): ProviderResumePoint {
	const terminalEvents = all<{ event: string; obsoleted: number }>(
		db,
		`SELECT e.event, r.obsoleted_at IS NOT NULL AS obsoleted FROM agent_events e
		 JOIN agent_runs r ON r.id = e.run_id AND r.session_id = e.session_id
		 WHERE e.session_id = ?
		   AND (e.event LIKE 'run.completed' || char(10) || '%' OR e.event LIKE 'run.failed' || char(10) || '%')
		 ORDER BY e.seq DESC`,
		sessionId,
	);
	let undoneCursor = false;
	for (const row of terminalEvents) {
		const { payload } = eventFromBlob(row.event);
		const cursor = isRecord(payload) ? payload['providerCursor'] : undefined;
		if (typeof cursor !== 'string' || cursor.length === 0) continue;
		if (!row.obsoleted) return { resumeAt: cursor };
		undoneCursor = true;
	}
	return undoneCursor ? { freshConversation: true } : {};
}

export function latestEventId(db: MaliniDatabase, sessionId: string): number {
	const row = get<{ seq: number | null }>(
		db,
		'SELECT MAX(seq) AS seq FROM agent_events WHERE session_id = ?',
		sessionId,
	);
	return row?.seq ?? 0;
}

export function eventJsonFromKindPayload(kind: string, payload: unknown): Record<string, unknown> {
	const event: Record<string, unknown> = isRecord(payload) ? { ...payload } : {};
	event['type'] = kind;
	return event;
}

export function envelopeJson(
	sessionId: string,
	runId: string,
	seq: number,
	event: Record<string, unknown>,
): AgentEventEnvelope {
	const kind = typeof event['type'] === 'string' ? event['type'] : '';
	const shaped: Record<string, unknown> = { ...event };
	if (kind !== 'session.state' && runId !== '') shaped['runId'] = runId;
	if (
		kind === 'run.started' ||
		kind === 'session.state' ||
		kind === 'approval.requested' ||
		kind === 'question.requested'
	) {
		shaped['sessionId'] = sessionId;
	}
	return { sessionId, runId, seq, event: shaped };
}

export const HISTORY_EVENT_KINDS: readonly string[] = [
	'checkpoint.restored',
	'turn.superseded',
	'turn.restored',
	'run.obsoleted',
	'run.restored',
	'session.branched',
];

export function isHistoryEventKind(kind: string): boolean {
	return HISTORY_EVENT_KINDS.includes(kind);
}

export function isNewTalkEventKind(kind: string): boolean {
	return kind === 'user.message' || kind === 'run.started';
}

export interface SupersededRange {
	fromSeq: number;
	toSeq: number;
}

export function supersededRanges(rows: readonly AgentEventRow[]): SupersededRange[] {
	const ranges: SupersededRange[] = [];
	for (const row of rows) {
		if ((row.kind === 'turn.superseded' || row.kind === 'turn.restored') && isRecord(row.payload)) {
			const fromSeq = row.payload['fromSeq'];
			const toSeq = row.payload['toSeq'];
			if (typeof fromSeq !== 'number' || typeof toSeq !== 'number') continue;
			if (row.kind === 'turn.superseded') {
				ranges.push({ fromSeq, toSeq });
			} else {
				const index = ranges.findIndex(
					(range) => range.fromSeq === fromSeq && range.toSeq === toSeq,
				);
				if (index >= 0) ranges.splice(index, 1);
			}
		}
	}
	return ranges;
}

export function seqInSupersededRange(seq: number, ranges: readonly SupersededRange[]): boolean {
	return ranges.some((range) => seq >= range.fromSeq && seq <= range.toSeq);
}
