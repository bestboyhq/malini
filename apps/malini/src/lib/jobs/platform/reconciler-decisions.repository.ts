import type {
	ReconcilerCandidate,
	ReconcilerDecider,
	ReconcilerDecisionRecord,
	ReconcilerDecisionStatus,
} from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, isRecord, run } from '$main/db/rows';

interface DecisionRow {
	id: string;
	event_id: number;
	channel: string;
	chain_id: string;
	workstream_id: string | null;
	facts: string;
	candidates: string;
	pick: number | null;
	chosen: number;
	decided_by: ReconcilerDecider;
	status: ReconcilerDecisionStatus;
	detail: string | null;
	job_run_id: string | null;
	created_at: string;
	finished_at: string | null;
}

const COLUMNS =
	'id, event_id, channel, chain_id, workstream_id, facts, candidates, pick, chosen, decided_by, status, detail, job_run_id, created_at, finished_at';

function fromRow(row: DecisionRow): ReconcilerDecisionRecord {
	return {
		id: row.id,
		eventId: row.event_id,
		channel: row.channel,
		chainId: row.chain_id,
		workstreamId: row.workstream_id,
		facts: stringList(row.facts),
		candidates: candidateList(row.candidates),
		pick: row.pick,
		chosen: row.chosen,
		decidedBy: row.decided_by,
		status: row.status,
		detail: row.detail,
		jobRunId: row.job_run_id,
		createdAt: row.created_at,
		finishedAt: row.finished_at,
	};
}

function parsedList(text: string): unknown[] {
	try {
		const value: unknown = JSON.parse(text);
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

function stringList(text: string): string[] {
	return parsedList(text).filter((item): item is string => typeof item === 'string');
}

function candidateList(text: string): ReconcilerCandidate[] {
	return parsedList(text).flatMap((item) => {
		const candidate = asCandidate(item);
		return candidate ? [candidate] : [];
	});
}

function asCandidate(item: unknown): ReconcilerCandidate | null {
	if (!isRecord(item) || typeof item['label'] !== 'string') return null;
	const label = item['label'];
	const text = (key: string): string | null => {
		const value = item[key];
		return typeof value === 'string' ? value : null;
	};
	switch (item['kind']) {
		case 'nothing':
			return { kind: 'nothing', label };
		case 'ask-you': {
			const reason = text('reason');
			return reason === null ? null : { kind: 'ask-you', label, reason };
		}
		case 'wake-chat': {
			const sessionId = text('sessionId');
			const workstreamId = text('workstreamId');
			const from = text('from');
			const report = text('report');
			return sessionId === null || workstreamId === null || from === null || report === null
				? null
				: { kind: 'wake-chat', label, sessionId, workstreamId, from, report };
		}
		case 'run-job': {
			const definitionId = text('definitionId');
			const workstreamId = text('workstreamId');
			const context = text('context');
			return definitionId === null || workstreamId === null || context === null
				? null
				: { kind: 'run-job', label, definitionId, workstreamId, context };
		}
		default:
			return null;
	}
}

export function insertDecision(db: MaliniDatabase, decision: ReconcilerDecisionRecord): void {
	run(
		db,
		`INSERT INTO reconciler_decisions (${COLUMNS})
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		decision.id,
		decision.eventId,
		decision.channel,
		decision.chainId,
		decision.workstreamId,
		JSON.stringify(decision.facts),
		JSON.stringify(decision.candidates),
		decision.pick,
		decision.chosen,
		decision.decidedBy,
		decision.status,
		decision.detail,
		decision.jobRunId,
		decision.createdAt,
		decision.finishedAt,
	);
}

export function saveDecision(db: MaliniDatabase, decision: ReconcilerDecisionRecord): void {
	run(
		db,
		`UPDATE reconciler_decisions
		 SET candidates = ?, chosen = ?, decided_by = ?, status = ?, detail = ?, job_run_id = ?,
		     finished_at = ?
		 WHERE id = ?`,
		JSON.stringify(decision.candidates),
		decision.chosen,
		decision.decidedBy,
		decision.status,
		decision.detail,
		decision.jobRunId,
		decision.finishedAt,
		decision.id,
	);
}

export function getDecision(db: MaliniDatabase, id: string): ReconcilerDecisionRecord | null {
	const row = get<DecisionRow>(db, `SELECT ${COLUMNS} FROM reconciler_decisions WHERE id = ?`, id);
	return row ? fromRow(row) : null;
}

export function decidedEvent(db: MaliniDatabase, eventId: number): boolean {
	return get(db, 'SELECT 1 FROM reconciler_decisions WHERE event_id = ? LIMIT 1', eventId) !== null;
}

export function listChainDecisions(
	db: MaliniDatabase,
	chainId: string,
): ReconcilerDecisionRecord[] {
	return all<DecisionRow>(
		db,
		`SELECT ${COLUMNS} FROM reconciler_decisions WHERE chain_id = ? ORDER BY created_at`,
		chainId,
	).map(fromRow);
}

export function listPendingDecisions(db: MaliniDatabase): ReconcilerDecisionRecord[] {
	return all<DecisionRow>(
		db,
		`SELECT ${COLUMNS} FROM reconciler_decisions WHERE status = 'pending' ORDER BY created_at`,
	).map(fromRow);
}

export function listDecisions(db: MaliniDatabase, recent: number): ReconcilerDecisionRecord[] {
	return all<DecisionRow>(
		db,
		`SELECT ${COLUMNS} FROM reconciler_decisions
		 WHERE status IN ('pending', 'asking')
		    OR id IN (SELECT id FROM reconciler_decisions ORDER BY created_at DESC LIMIT ?)
		 ORDER BY created_at DESC`,
		recent,
	).map(fromRow);
}

export function pruneDecisions(db: MaliniDatabase, before: string): number {
	return run(
		db,
		`DELETE FROM reconciler_decisions
		 WHERE created_at < ? AND status NOT IN ('pending', 'asking')`,
		before,
	).changes;
}

export function listDecisionsSince(db: MaliniDatabase, since: string): ReconcilerDecisionRecord[] {
	return all<DecisionRow>(
		db,
		`SELECT ${COLUMNS} FROM reconciler_decisions
		 WHERE created_at >= ? OR finished_at IS NULL ORDER BY created_at`,
		since,
	).map(fromRow);
}
