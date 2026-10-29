import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import type { MaliniDatabase } from '$main/db/driver';
import { invariant } from '$main/errors';
import { all, column, get, isRecord, run } from '$main/db/rows';

export interface PackedEvent {
	readonly seq: number;
	readonly runId: string;
	readonly event: string;
	readonly emittedAt: string;
}

const PACKED_KINDS = [
	'tool.started',
	'tool.completed',
	'tool.failed',
	'command.completed',
	'thinking.message',
];
const IS_PACKED_KIND = `substr(event, 1, instr(event, char(10)) - 1) IN (${PACKED_KINDS.map(() => '?').join(', ')})`;
const ARCHIVED = `(s.archived_at IS NOT NULL OR w.status = 'archived')`;
const PACK_QUALITY = 6;

export function packedEvents(db: MaliniDatabase, sessionId: string): PackedEvent[] {
	const pack = packOf(db, sessionId);
	return pack ? decodePack(pack) : [];
}

export function packSessionEvents(db: MaliniDatabase, sessionId: string): void {
	db.transaction(() => {
		if (!sessionIsArchived(db, sessionId)) return;
		const loose = all<{ seq: number; run_id: string; event: string; emitted_at: string }>(
			db,
			`SELECT seq, run_id, event, emitted_at FROM agent_events
			 WHERE session_id = ? AND ${IS_PACKED_KIND} ORDER BY seq`,
			sessionId,
			...PACKED_KINDS,
		);
		const pack = packOf(db, sessionId);
		if (pack && loose.length === 0) return;
		const events = [
			...(pack ? decodePack(pack) : []),
			...loose.map((row) => ({
				seq: row.seq,
				runId: row.run_id,
				event: row.event,
				emittedAt: row.emitted_at,
			})),
		].sort((left, right) => left.seq - right.seq);
		run(
			db,
			`INSERT INTO agent_event_packs (session_id, events) VALUES (?, ?)
			 ON CONFLICT (session_id) DO UPDATE SET events = excluded.events`,
			sessionId,
			encodePack(events),
		);
		run(
			db,
			`DELETE FROM agent_events WHERE session_id = ? AND ${IS_PACKED_KIND}`,
			sessionId,
			...PACKED_KINDS,
		);
	});
}

export function unpackSessionEvents(db: MaliniDatabase, sessionId: string): void {
	db.transaction(() => {
		if (sessionIsArchived(db, sessionId)) return;
		run(
			db,
			'DELETE FROM agent_run_tool_calls WHERE run_id IN (SELECT id FROM agent_runs WHERE session_id = ?)',
			sessionId,
		);
		for (const { seq, runId, event, emittedAt } of packedEvents(db, sessionId)) {
			run(
				db,
				'INSERT INTO agent_events (seq, session_id, run_id, event, emitted_at) VALUES (?, ?, ?, ?, ?)',
				seq,
				sessionId,
				runId,
				event,
				emittedAt,
			);
		}
		run(db, 'DELETE FROM agent_event_packs WHERE session_id = ?', sessionId);
		run(
			db,
			`UPDATE agent_runs SET event_bytes = (
			   SELECT COALESCE(SUM(LENGTH(e.event)), 0) FROM agent_events e
			   WHERE e.run_id = agent_runs.id AND e.session_id = agent_runs.session_id
			 ) WHERE session_id = ?`,
			sessionId,
		);
	});
}

export function archivedSessionsToPack(db: MaliniDatabase): string[] {
	return column(
		db,
		`SELECT s.id FROM agent_sessions s JOIN workstreams w ON w.id = s.workstream_id
		 WHERE ${ARCHIVED} AND NOT EXISTS (SELECT 1 FROM agent_event_packs p WHERE p.session_id = s.id)
		 ORDER BY s.rowid`,
	);
}

export function liveSessionsToUnpack(db: MaliniDatabase): string[] {
	return column(
		db,
		`SELECT s.id FROM agent_event_packs p
		 JOIN agent_sessions s ON s.id = p.session_id
		 JOIN workstreams w ON w.id = s.workstream_id
		 WHERE NOT ${ARCHIVED}`,
	);
}

function sessionIsArchived(db: MaliniDatabase, sessionId: string): boolean {
	return (
		get(
			db,
			`SELECT 1 AS archived FROM agent_sessions s JOIN workstreams w ON w.id = s.workstream_id
			 WHERE s.id = ? AND ${ARCHIVED}`,
			sessionId,
		) !== null
	);
}

function packOf(db: MaliniDatabase, sessionId: string): Uint8Array | null {
	return (
		get<{ events: Uint8Array }>(
			db,
			'SELECT events FROM agent_event_packs WHERE session_id = ?',
			sessionId,
		)?.events ?? null
	);
}

function encodePack(events: readonly PackedEvent[]): Buffer {
	const json = Buffer.from(JSON.stringify(events));
	return brotliCompressSync(json, {
		params: {
			[constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
			[constants.BROTLI_PARAM_QUALITY]: PACK_QUALITY,
			[constants.BROTLI_PARAM_SIZE_HINT]: json.length,
		},
	});
}

function decodePack(blob: Uint8Array): PackedEvent[] {
	const events: unknown = JSON.parse(brotliDecompressSync(blob).toString());
	if (Array.isArray(events) && events.every(isPackedEvent)) return events;
	throw invariant('a packed chat holds something other than a list of events');
}

function isPackedEvent(value: unknown): value is PackedEvent {
	return (
		isRecord(value) &&
		typeof value['seq'] === 'number' &&
		typeof value['runId'] === 'string' &&
		typeof value['event'] === 'string' &&
		typeof value['emittedAt'] === 'string'
	);
}
