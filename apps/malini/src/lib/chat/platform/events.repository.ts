import type { MaliniDatabase } from '$main/db/driver';
import { invariant } from '$main/errors';
import { all, column, get, isRecord, nowIso8601, run } from '$main/db/rows';
import type { AgentEventEnvelope } from '$contract/agent';
import type { WorkstreamTurn } from '$contract/stats';
import {
	hasTurnReport,
	markdownImages,
	parseTurnReport,
	workstreamImagePath,
} from '../domain/turn-report';

export type { AgentEventEnvelope };

const SHOWN_MEDIA = /\.(?:png|jpe?g|gif|webp|mp4|m4v|mov|webm)$/iu;

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

export interface AgentEventRowPage {
	rows: AgentEventRow[];
	startSeq: number;
	complete: boolean;
	overBudget: boolean;
}

export function listEventRowPage(
	db: MaliniDatabase,
	sessionId: string,
	afterSeq: number,
	beforeSeq: number,
	byteBudget: number,
): AgentEventRowPage {
	const budget = Math.max(0, Math.floor(byteBudget));
	const picked = get<{ start: number | null; over_budget: number }>(
		db,
		`WITH tail AS (
				SELECT first_seq, SUM(event_bytes) OVER (ORDER BY first_seq DESC) AS tail_bytes
				FROM agent_runs WHERE session_id = ? AND first_seq > ? AND first_seq < ?
			)
			SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tail WHERE tail_bytes > ?) THEN NULL
				ELSE COALESCE(
					(SELECT MIN(first_seq) FROM tail WHERE tail_bytes <= ?),
					(SELECT MAX(first_seq) FROM tail)
				) END AS start,
				NOT EXISTS (SELECT 1 FROM tail WHERE tail_bytes <= ?)
					AND EXISTS (SELECT 1 FROM tail) AS over_budget`,
		sessionId,
		afterSeq,
		beforeSeq,
		budget,
		budget,
		budget,
	);
	const start = picked?.start ?? afterSeq + 1;
	const rows = all<{ seq: number; run_id: string; event: string }>(
		db,
		'SELECT seq, run_id, event FROM agent_events WHERE session_id = ? AND seq >= ? AND seq < ? ORDER BY seq ASC',
		sessionId,
		start,
		beforeSeq,
	).map((row) => ({ seq: row.seq, runId: row.run_id, ...eventFromBlob(row.event) }));
	const earlier = get<{ seq: number }>(
		db,
		'SELECT seq FROM agent_events WHERE session_id = ? AND seq > ? AND seq < ? LIMIT 1',
		sessionId,
		afterSeq,
		start,
	);
	return {
		rows,
		startSeq: start,
		complete: earlier === null,
		overBudget: picked?.over_budget === 1,
	};
}

export function listEventRowsOfKinds(
	db: MaliniDatabase,
	sessionId: string,
	kinds: readonly string[],
	kindsWithPayload: readonly string[],
): AgentEventRow[] {
	const marks = (list: readonly string[]): string => list.map(() => '?').join(', ') || 'NULL';
	return all<{ seq: number; run_id: string; kind: string; event: string | null }>(
		db,
		`SELECT seq, run_id, kind, CASE WHEN kind IN (${marks(kindsWithPayload)}) THEN event END AS event
		 FROM (SELECT seq, run_id, event, substr(event, 1, instr(event, char(10)) - 1) AS kind
		       FROM agent_events WHERE session_id = ?)
		 WHERE kind IN (${marks(kinds)}) ORDER BY seq ASC`,
		...kindsWithPayload,
		sessionId,
		...kinds,
	).map((row) => ({
		seq: row.seq,
		runId: row.run_id,
		...(row.event === null ? { kind: row.kind, payload: null } : eventFromBlob(row.event)),
	}));
}

export function toolCallOutput(
	db: MaliniDatabase,
	sessionId: string,
	toolCallId: string,
): string | null {
	const match = all<{ event: string }>(
		db,
		`SELECT event FROM agent_events
		 WHERE session_id = ? AND event LIKE 'tool.completed' || char(10) || '%' AND instr(event, ?) > 0
		 ORDER BY seq DESC`,
		sessionId,
		`"toolCallId":${JSON.stringify(toolCallId)}`,
	)
		.map((row) => eventFromBlob(row.event).payload)
		.find((payload) => isRecord(payload) && payload['toolCallId'] === toolCallId);
	const output = isRecord(match) ? match['output'] : null;
	return typeof output === 'string' ? output : null;
}

export type ProviderResumePoint =
	{ readonly resumeAt: string } | { readonly freshConversation: true } | Record<string, never>;

export function providerResumePoint(db: MaliniDatabase, sessionId: string): ProviderResumePoint {
	const resumePoints = all<{ event: string; obsoleted: number }>(
		db,
		`SELECT e.event, r.obsoleted_at IS NOT NULL AS obsoleted FROM agent_events e
		 JOIN agent_runs r ON r.id = e.run_id AND r.session_id = e.session_id
		 WHERE e.session_id = ?
		   AND (e.event LIKE 'run.completed' || char(10) || '%' OR e.event LIKE 'run.failed' || char(10) || '%'
		     OR e.event LIKE 'background.updated' || char(10) || '%')
		 ORDER BY e.seq DESC`,
		sessionId,
	);
	let undoneCursor = false;
	for (const row of resumePoints) {
		const { payload } = eventFromBlob(row.event);
		const cursor = isRecord(payload) ? payload['providerCursor'] : undefined;
		if (typeof cursor !== 'string' || cursor.length === 0) continue;
		if (!row.obsoleted) return { resumeAt: cursor };
		undoneCursor = true;
	}
	return undoneCursor ? { freshConversation: true } : {};
}

export function runIsWaitingOnBackgroundWork(db: MaliniDatabase, runId: string): boolean {
	const background = latestBackgroundWork(db, runId);
	return isRecord(background) && background['waiting'] === true;
}

export function workstreamHasWorkingRun(db: MaliniDatabase, workstreamId: string): boolean {
	return column(
		db,
		`SELECT r.id FROM agent_runs r JOIN agent_sessions s ON s.id = r.session_id
		 WHERE s.workstream_id = ? AND r.completed_at IS NULL`,
		workstreamId,
	).some((runId) => !waitsOnlyOnBackgroundCommands(latestBackgroundWork(db, runId)));
}

export function turnEndedOverBackgroundCommands(event: Readonly<Record<string, unknown>>): boolean {
	return event['type'] === 'background.updated' && waitsOnlyOnBackgroundCommands(event);
}

function waitsOnlyOnBackgroundCommands(background: unknown): boolean {
	if (!isRecord(background) || background['waiting'] !== true) return false;
	const tasks = background['tasks'];
	return (
		Array.isArray(tasks) &&
		tasks.length > 0 &&
		tasks.every((task: unknown) => isRecord(task) && task['kind'] === 'command')
	);
}

function latestBackgroundWork(db: MaliniDatabase, runId: string): unknown {
	const row = get<{ event: string }>(
		db,
		`SELECT event FROM agent_events
		 WHERE run_id = ? AND event LIKE 'background.updated' || char(10) || '%'
		 ORDER BY seq DESC LIMIT 1`,
		runId,
	);
	return row ? eventFromBlob(row.event).payload : null;
}

export interface OpenBackgroundCommand {
	readonly sessionId: string;
	readonly workstreamId: string;
	readonly taskId: string;
	readonly description: string;
	readonly startedAt: number;
	readonly toolCallId: string | null;
}

export function listOpenBackgroundCommands(db: MaliniDatabase): OpenBackgroundCommand[] {
	return all<{ session_id: string; workstream_id: string; event: string | null }>(
		db,
		`SELECT r.session_id, s.workstream_id,
		   (SELECT e.event FROM agent_events e
		    WHERE e.run_id = r.id AND e.event LIKE 'background.updated' || char(10) || '%'
		    ORDER BY e.seq DESC LIMIT 1) AS event
		 FROM agent_runs r JOIN agent_sessions s ON s.id = r.session_id
		 WHERE r.completed_at IS NULL AND s.archived_at IS NULL
		 ORDER BY r.started_at ASC, r.id ASC`,
	).flatMap((row) =>
		row.event === null
			? []
			: backgroundCommands(row.session_id, row.workstream_id, eventFromBlob(row.event).payload),
	);
}

function backgroundCommands(
	sessionId: string,
	workstreamId: string,
	payload: unknown,
): OpenBackgroundCommand[] {
	if (!isRecord(payload) || payload['interim'] === true) return [];
	const tasks: unknown = payload['tasks'];
	if (!Array.isArray(tasks)) return [];
	return tasks.flatMap((task: unknown) => {
		if (!isRecord(task) || task['kind'] !== 'command') return [];
		const { taskId, description, startedAt, toolCallId } = task;
		if (typeof taskId !== 'string' || typeof startedAt !== 'number') return [];
		return [
			{
				sessionId,
				workstreamId,
				taskId,
				description: typeof description === 'string' ? description : '',
				startedAt,
				toolCallId: typeof toolCallId === 'string' ? toolCallId : null,
			},
		];
	});
}

export interface BackgroundCommandSource {
	readonly command: string;
	readonly outputFile: string | null;
}

const BACKGROUND_OUTPUT_FILE = /Output is being written to: (\S+\.output)/u;

export function backgroundCommandSource(
	db: MaliniDatabase,
	sessionId: string,
	toolCallId: string,
): BackgroundCommandSource | null {
	let command: string | null = null;
	let outputFile: string | null = null;
	for (const row of all<{ event: string }>(
		db,
		`SELECT event FROM agent_events
		 WHERE session_id = ? AND instr(event, ?) > 0
		   AND (event LIKE 'tool.started' || char(10) || '%' OR event LIKE 'tool.completed' || char(10) || '%')
		 ORDER BY seq ASC`,
		sessionId,
		`"toolCallId":${JSON.stringify(toolCallId)}`,
	)) {
		const { kind, payload } = eventFromBlob(row.event);
		if (!isRecord(payload) || payload['toolCallId'] !== toolCallId) continue;
		const input = payload['input'];
		if (kind === 'tool.started' && isRecord(input) && typeof input['command'] === 'string') {
			command = input['command'];
		}
		if (kind === 'tool.completed' && typeof payload['output'] === 'string') {
			outputFile = BACKGROUND_OUTPUT_FILE.exec(payload['output'])?.[1] ?? outputFile;
		}
	}
	return command === null ? null : { command, outputFile };
}

export function latestWorkstreamTurn(
	db: MaliniDatabase,
	workstreamId: string,
): WorkstreamTurn | null {
	const row = get<{ event: string; emitted_at: string }>(
		db,
		`SELECT event, emitted_at FROM agent_events WHERE seq IN (
		   SELECT (SELECT t.seq FROM agent_events t
		     WHERE t.session_id = s.id
		       AND (t.event LIKE 'run.completed' || char(10) || '%'
		         OR (t.event LIKE 'background.updated' || char(10) || '%' AND instr(t.event, '"summary":') > 0))
		       AND NOT EXISTS (
		         SELECT 1 FROM agent_runs r WHERE r.id = t.run_id AND r.obsoleted_at IS NOT NULL
		       )
		     ORDER BY t.seq DESC LIMIT 1)
		   FROM agent_sessions s
		   WHERE s.workstream_id = ? AND s.origin = 'user' AND s.archived_at IS NULL
		 )
		 ORDER BY seq DESC LIMIT 1`,
		workstreamId,
	);
	if (!row) return null;
	const { payload } = eventFromBlob(row.event);
	const summary =
		isRecord(payload) && typeof payload['summary'] === 'string' ? payload['summary'] : '';
	const report = parseTurnReport(summary);
	return {
		endedAt: Date.parse(row.emitted_at),
		outcome:
			report.outcome ??
			summary
				.split('\n')
				.find((line) => line.trim() !== '')
				?.trim() ??
			null,
		need: report.needs[0] ?? null,
	};
}

export function latestRunReport(db: MaliniDatabase, runId: string): string | null {
	for (const row of all<{ event: string }>(
		db,
		`SELECT event FROM agent_events
		 WHERE run_id = ? AND event LIKE 'assistant.message' || char(10) || '%'
		 ORDER BY seq DESC`,
		runId,
	)) {
		const { payload } = eventFromBlob(row.event);
		const text = isRecord(payload) ? payload['text'] : null;
		if (typeof text === 'string' && hasTurnReport(text)) return text;
	}
	return null;
}

export function agentHasReadFile(db: MaliniDatabase, workstreamId: string, path: string): boolean {
	return all<{ event: string }>(
		db,
		`SELECT e.event FROM agent_events e JOIN agent_sessions s ON s.id = e.session_id
		 WHERE s.workstream_id = ? AND e.event LIKE 'tool.started' || char(10) || '%'
		   AND instr(e.event, ?) > 0`,
		workstreamId,
		`"file_path":${JSON.stringify(path)}`,
	).some((row) => {
		const { payload } = eventFromBlob(row.event);
		if (!isRecord(payload) || payload['name'] !== 'Read') return false;
		return isRecord(payload['input']) && payload['input']['file_path'] === path;
	});
}

export function shownMediaPaths(event: Record<string, unknown>): string[] {
	if (event['type'] === 'tool.started' && event['name'] === 'Read') {
		const input = event['input'];
		const path = isRecord(input) ? input['file_path'] : null;
		return typeof path === 'string' && SHOWN_MEDIA.test(path) ? [path] : [];
	}
	if (event['type'] !== 'assistant.message' || typeof event['text'] !== 'string') return [];
	return markdownImages(event['text']).flatMap(({ src }) => {
		const path = workstreamImagePath(src);
		return path !== null && SHOWN_MEDIA.test(path) ? [path] : [];
	});
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

const TOOL_OUTPUT_PREVIEW_CHARS = 8 * 1024;

export function withToolOutputPreview<Envelope extends AgentEventEnvelope>(
	envelope: Envelope,
): Envelope {
	const { event } = envelope;
	const output = event['output'];
	if (event['type'] !== 'tool.completed' || typeof output !== 'string') return envelope;
	if (output.length <= TOOL_OUTPUT_PREVIEW_CHARS) return envelope;
	event['output'] = output.slice(0, TOOL_OUTPUT_PREVIEW_CHARS);
	event['outputTruncated'] = true;
	event['outputLength'] = output.length;
	return envelope;
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
