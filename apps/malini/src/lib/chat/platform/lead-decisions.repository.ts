import type {
	LeadDecision,
	LeadDecisionDecider,
	LeadDecisionOption,
	LeadDecisionPicture,
} from '$contract/leads';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, isRecord, run } from '$main/db/rows';

export type NewLeadDecision = Omit<LeadDecision, 'workstreamId' | 'answer'>;

interface DecisionRow {
	id: string;
	session_id: string;
	workstream_id: string;
	topic: string;
	question: string;
	why: string | null;
	options: string;
	recommended: number;
	meanwhile: string | null;
	asked_at: string;
	answer_option: number | null;
	answer_by: LeadDecisionDecider | null;
	answer_reason: string | null;
	answered_at: string | null;
}

const SELECT = `SELECT d.id, d.session_id, s.workstream_id, d.topic, d.question, d.why, d.options,
	d.recommended, d.meanwhile, d.asked_at, d.answer_option, d.answer_by, d.answer_reason,
	d.answered_at
	FROM lead_decisions d JOIN agent_sessions s ON s.id = d.session_id`;

function fromRow(row: DecisionRow): LeadDecision {
	return {
		id: row.id,
		sessionId: row.session_id,
		workstreamId: row.workstream_id,
		topic: row.topic,
		question: row.question,
		why: row.why,
		options: optionList(row.options),
		recommended: row.recommended,
		meanwhile: row.meanwhile,
		askedAt: row.asked_at,
		answer:
			row.answer_option === null || row.answer_by === null || row.answered_at === null
				? null
				: {
						option: row.answer_option,
						by: row.answer_by,
						reason: row.answer_reason,
						at: row.answered_at,
					},
	};
}

export function insertLeadDecision(db: MaliniDatabase, decision: NewLeadDecision): void {
	run(
		db,
		`INSERT INTO lead_decisions
		 (id, session_id, topic, question, why, options, recommended, meanwhile, asked_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		decision.id,
		decision.sessionId,
		decision.topic,
		decision.question,
		decision.why,
		JSON.stringify(decision.options),
		decision.recommended,
		decision.meanwhile,
		decision.askedAt,
	);
}

export function answerLeadDecision(
	db: MaliniDatabase,
	id: string,
	answer: Readonly<{ option: number; by: LeadDecisionDecider; reason: string | null; at: string }>,
): LeadDecision | null {
	run(
		db,
		`UPDATE lead_decisions SET answer_option = ?, answer_by = ?, answer_reason = ?, answered_at = ?
		 WHERE id = ?`,
		answer.option,
		answer.by,
		answer.reason,
		answer.at,
		id,
	);
	return getLeadDecision(db, id);
}

export function getLeadDecision(db: MaliniDatabase, id: string): LeadDecision | null {
	const row = get<DecisionRow>(db, `${SELECT} WHERE d.id = ?`, id);
	return row ? fromRow(row) : null;
}

export function listLeadDecisions(db: MaliniDatabase, sessionId: string): LeadDecision[] {
	return all<DecisionRow>(
		db,
		`${SELECT} WHERE d.session_id = ? ORDER BY d.asked_at, d.rowid`,
		sessionId,
	).map(fromRow);
}

function optionList(text: string): LeadDecisionOption[] {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return [];
	}
	if (!Array.isArray(value)) return [];
	return value.flatMap((option: unknown) =>
		isRecord(option) && typeof option['label'] === 'string'
			? [
					{
						label: option['label'],
						note: typeof option['note'] === 'string' ? option['note'] : null,
						picture: pictureOf(option['picture']),
					},
				]
			: [],
	);
}

function pictureOf(value: unknown): LeadDecisionPicture | null {
	return isRecord(value) &&
		typeof value['workstreamId'] === 'string' &&
		typeof value['path'] === 'string'
		? { workstreamId: value['workstreamId'], path: value['path'] }
		: null;
}
