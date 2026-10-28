import type { ChatDelivery, ChatDeliveryStatus, WorkstreamReport } from '$contract/deliveries';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';
import { parseWorkstreamReport, type DeliveryItem, type DeliveryKind } from '../domain/deliveries';

export type NewDelivery = Readonly<{
	sessionId: string;
	kind: DeliveryKind;
	prompt: string;
	fromSessionId?: string | null;
	fromWorkstreamId?: string | null;
	report?: WorkstreamReport | null;
	decisionId?: string | null;
	profile?: unknown;
	chainId?: string | null;
	causeEventId?: number | null;
}>;

export type WaitingDelivery = DeliveryItem & Readonly<{ id: string; profile: unknown }>;

interface DeliveryRow {
	id: string;
	session_id: string;
	from_session_id: string | null;
	status: ChatDeliveryStatus;
	run_id: string | null;
	detail: string | null;
	created_at: string;
	delivered_at: string | null;
}

interface WaitingRow {
	id: string;
	kind: DeliveryKind;
	prompt: string;
	from_workstream_id: string | null;
	report: string | null;
	decision_id: string | null;
	profile: string | null;
	chain_id: string | null;
	cause_event_id: number | null;
}

const COLUMNS = 'id, session_id, from_session_id, status, run_id, detail, created_at, delivered_at';

function fromRow(row: DeliveryRow): ChatDelivery {
	return {
		id: row.id,
		sessionId: row.session_id,
		fromSessionId: row.from_session_id,
		status: row.status,
		runId: row.run_id,
		detail: row.detail,
		createdAt: row.created_at,
		deliveredAt: row.delivered_at,
	};
}

export function insertDelivery(
	db: MaliniDatabase,
	id: string,
	delivery: NewDelivery,
	createdAt: string,
): ChatDelivery {
	run(
		db,
		`INSERT INTO agent_deliveries
		 (id, session_id, kind, prompt, from_session_id, from_workstream_id, report, decision_id,
		  profile, chain_id, cause_event_id, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`,
		id,
		delivery.sessionId,
		delivery.kind,
		delivery.prompt,
		delivery.fromSessionId ?? null,
		delivery.fromWorkstreamId ?? null,
		delivery.report ? JSON.stringify(delivery.report) : null,
		delivery.decisionId ?? null,
		delivery.profile === undefined || delivery.profile === null
			? null
			: JSON.stringify(delivery.profile),
		delivery.chainId ?? null,
		delivery.causeEventId ?? null,
		createdAt,
	);
	return getDelivery(db, id) ?? missing(id);
}

export function getDelivery(db: MaliniDatabase, id: string): ChatDelivery | null {
	const row = get<DeliveryRow>(db, `SELECT ${COLUMNS} FROM agent_deliveries WHERE id = ?`, id);
	return row ? fromRow(row) : null;
}

export function waitingDeliveries(db: MaliniDatabase, sessionId: string): WaitingDelivery[] {
	return all<WaitingRow>(
		db,
		`SELECT id, kind, prompt, from_workstream_id, report, decision_id, profile, chain_id,
		   cause_event_id
		 FROM agent_deliveries WHERE session_id = ? AND status = 'waiting'
		 ORDER BY created_at, rowid`,
		sessionId,
	).map((row) => ({
		id: row.id,
		kind: row.kind,
		prompt: row.prompt,
		fromWorkstreamId: row.from_workstream_id,
		report: parsedReport(row.report),
		decisionId: row.decision_id,
		profile: row.profile === null ? null : parsedJson(row.profile),
		chainId: row.chain_id,
		causeEventId: row.cause_event_id,
	}));
}

export function sessionsWithWaitingDeliveries(db: MaliniDatabase): string[] {
	return all<{ session_id: string }>(
		db,
		`SELECT session_id FROM agent_deliveries WHERE status = 'waiting'
		 GROUP BY session_id ORDER BY MIN(created_at)`,
	).map((row) => row.session_id);
}

export function settleDeliveries(
	db: MaliniDatabase,
	ids: readonly string[],
	outcome: Readonly<
		{ status: 'delivered'; runId: string; at: string } | { status: 'failed'; detail: string }
	>,
): ChatDelivery[] {
	return db.transaction(() =>
		ids.flatMap((id) => {
			run(
				db,
				`UPDATE agent_deliveries SET status = ?, run_id = ?, detail = ?, delivered_at = ?
				 WHERE id = ? AND status = 'waiting'`,
				outcome.status,
				outcome.status === 'delivered' ? outcome.runId : null,
				outcome.status === 'failed' ? outcome.detail : null,
				outcome.status === 'delivered' ? outcome.at : null,
				id,
			);
			const settled = getDelivery(db, id);
			return settled ? [settled] : [];
		}),
	);
}

export function deliveriesFrom(db: MaliniDatabase, fromSessionId: string): ChatDelivery[] {
	return all<DeliveryRow>(
		db,
		`SELECT ${COLUMNS} FROM agent_deliveries WHERE from_session_id = ? ORDER BY created_at, rowid`,
		fromSessionId,
	).map(fromRow);
}

export function promptsSentInChain(
	db: MaliniDatabase,
	fromSessionId: string,
	sessionId: string,
	chainId: string,
): number {
	return (
		get<{ sent: number }>(
			db,
			`SELECT COUNT(*) AS sent FROM agent_deliveries
			 WHERE from_session_id = ? AND session_id = ? AND chain_id = ? AND kind = 'prompt'
			   AND status != 'failed'`,
			fromSessionId,
			sessionId,
			chainId,
		)?.sent ?? 0
	);
}

function parsedJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function parsedReport(text: string | null): WorkstreamReport | null {
	return text === null ? null : parseWorkstreamReport(parsedJson(text));
}

function missing(id: string): never {
	throw new Error(`Malini could not record the delivery \`${id}\`.`);
}
