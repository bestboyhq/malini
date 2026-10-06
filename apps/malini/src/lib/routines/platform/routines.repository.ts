import type {
	RoutineEvidence,
	RoutineGatedRunRecord,
	RoutineGatedRunState,
	RoutinePromptEvidence,
	RoutineOrigin,
	RoutineRecord,
	RoutineRun,
	RoutineStatus,
	RoutineSuggestionRecord,
	RoutineSuggestionStatus,
} from '$contract/routines';
import type { MaliniDatabase } from '$main/db/driver';
import { invariant } from '$main/errors';
import { all, get, run } from '$main/db/rows';

interface RoutineRow {
	id: string;
	status: RoutineStatus;
	origin: RoutineOrigin;
	label: string;
	trigger_when: string;
	run_json: string;
	evidence_json: string;
	created_at: string;
	updated_at: string;
}

interface GatedRunRow {
	id: string;
	routine_id: string;
	workstream_id: string;
	run_key: string;
	event: string;
	payload_json: string;
	state: RoutineGatedRunState;
	created_at: string;
	decided_at: string | null;
}

interface SuggestionRow {
	id: string;
	cluster_key: string;
	status: RoutineSuggestionStatus;
	evidence_json: string;
	created_at: string;
	updated_at: string;
}

const ROUTINE_COLUMNS =
	'id, status, origin, label, trigger_when, run_json, evidence_json, created_at, updated_at';
const GATED_RUN_COLUMNS =
	'id, routine_id, workstream_id, run_key, event, payload_json, state, created_at, decided_at';
const SUGGESTION_COLUMNS = 'id, cluster_key, status, evidence_json, created_at, updated_at';

export function insertRoutine(db: MaliniDatabase, routine: RoutineRecord): void {
	run(
		db,
		`INSERT INTO routines (${ROUTINE_COLUMNS})
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		routine.id,
		routine.status,
		routine.origin,
		routine.label,
		routine.when,
		JSON.stringify(routine.run),
		JSON.stringify(routine.evidence),
		routine.createdAt,
		routine.updatedAt,
	);
}

export function getRoutine(db: MaliniDatabase, routineId: string): RoutineRecord | null {
	const row = get<RoutineRow>(
		db,
		`SELECT ${ROUTINE_COLUMNS} FROM routines WHERE id = ?`,
		routineId,
	);
	return row ? routineFromRow(row) : null;
}

export function listRoutines(db: MaliniDatabase): RoutineRecord[] {
	return all<RoutineRow>(db, `SELECT ${ROUTINE_COLUMNS} FROM routines ORDER BY created_at, id`).map(
		routineFromRow,
	);
}

export function updateRoutineStatus(
	db: MaliniDatabase,
	routineId: string,
	status: RoutineStatus,
	updatedAt: string,
): RoutineRecord {
	const { changes } = run(
		db,
		'UPDATE routines SET status = ?, updated_at = ? WHERE id = ?',
		status,
		updatedAt,
		routineId,
	);
	if (changes === 0) throw invariant(`routine \`${routineId}\` not found`);
	const updated = getRoutine(db, routineId);
	if (!updated) throw invariant(`routine \`${routineId}\` not found`);
	return updated;
}

export function deleteRoutine(db: MaliniDatabase, routineId: string): boolean {
	return run(db, 'DELETE FROM routines WHERE id = ?', routineId).changes > 0;
}

export function recordGatedRun(
	db: MaliniDatabase,
	input: Readonly<{
		id: string;
		routineId: string;
		workstreamId: string;
		runKey: string;
		event: string;
		payload: unknown;
		createdAt: string;
	}>,
): { record: RoutineGatedRunRecord; created: boolean } {
	const { changes } = run(
		db,
		`INSERT OR IGNORE INTO routine_gated_runs (${GATED_RUN_COLUMNS})
		 VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
		input.id,
		input.routineId,
		input.workstreamId,
		input.runKey,
		input.event,
		JSON.stringify(input.payload ?? null),
		input.createdAt,
	);
	const row = get<GatedRunRow>(
		db,
		`SELECT ${GATED_RUN_COLUMNS} FROM routine_gated_runs WHERE run_key = ?`,
		input.runKey,
	);
	if (!row) throw invariant(`gated run for key \`${input.runKey}\` not found after insert`);
	return { record: gatedRunFromRow(row), created: changes > 0 };
}

export function getGatedRun(db: MaliniDatabase, gatedRunId: string): RoutineGatedRunRecord | null {
	const row = get<GatedRunRow>(
		db,
		`SELECT ${GATED_RUN_COLUMNS} FROM routine_gated_runs WHERE id = ?`,
		gatedRunId,
	);
	return row ? gatedRunFromRow(row) : null;
}

export function listGatedRuns(
	db: MaliniDatabase,
	filter: Readonly<{
		workstreamId?: string;
		state?: RoutineGatedRunState;
	}> = {},
): RoutineGatedRunRecord[] {
	const clauses: string[] = [];
	const params: string[] = [];
	if (filter.workstreamId !== undefined) {
		clauses.push('g.workstream_id = ?');
		params.push(filter.workstreamId);
	}
	if (filter.state !== undefined) {
		clauses.push('g.state = ?');
		params.push(filter.state);
	}
	const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
	return all<GatedRunRow>(
		db,
		`SELECT g.id, g.routine_id, g.workstream_id, g.run_key, g.event, g.payload_json,
		        g.state, g.created_at, g.decided_at
		 FROM routine_gated_runs g
		 ${where}
		 ORDER BY g.created_at, g.id`,
		...params,
	).map(gatedRunFromRow);
}

export function decideGatedRun(
	db: MaliniDatabase,
	gatedRunId: string,
	state: 'confirmed' | 'rejected',
	decidedAt: string,
): { record: RoutineGatedRunRecord; changed: boolean } {
	const existing = getGatedRun(db, gatedRunId);
	if (!existing) throw invariant(`gated run \`${gatedRunId}\` not found`);
	if (existing.state === state) return { record: existing, changed: false };
	if (existing.state !== 'pending') {
		throw invariant(`gated run \`${gatedRunId}\` is already ${existing.state}`);
	}
	run(
		db,
		'UPDATE routine_gated_runs SET state = ?, decided_at = ? WHERE id = ?',
		state,
		decidedAt,
		gatedRunId,
	);
	const updated = getGatedRun(db, gatedRunId);
	if (!updated) throw invariant(`gated run \`${gatedRunId}\` not found`);
	return { record: updated, changed: true };
}

export function rejectPendingGatedRuns(
	db: MaliniDatabase,
	routineId: string,
	decidedAt: string,
): RoutineGatedRunRecord[] {
	const pending = all<GatedRunRow>(
		db,
		`SELECT ${GATED_RUN_COLUMNS} FROM routine_gated_runs WHERE routine_id = ? AND state = 'pending'`,
		routineId,
	);
	return pending.map((row) => decideGatedRun(db, row.id, 'rejected', decidedAt).record);
}

export function insertSuggestionIfAbsent(
	db: MaliniDatabase,
	input: Readonly<{
		id: string;
		clusterKey: string;
		evidence: readonly RoutinePromptEvidence[];
		createdAt: string;
	}>,
): RoutineSuggestionRecord | null {
	const { changes } = run(
		db,
		`INSERT OR IGNORE INTO routine_suggestions (${SUGGESTION_COLUMNS})
		 VALUES (?, ?, 'open', ?, ?, ?)`,
		input.id,
		input.clusterKey,
		JSON.stringify(input.evidence),
		input.createdAt,
		input.createdAt,
	);
	if (changes === 0) return null;
	return getSuggestion(db, input.id);
}

export function getSuggestion(
	db: MaliniDatabase,
	suggestionId: string,
): RoutineSuggestionRecord | null {
	const row = get<SuggestionRow>(
		db,
		`SELECT ${SUGGESTION_COLUMNS} FROM routine_suggestions WHERE id = ?`,
		suggestionId,
	);
	return row ? suggestionFromRow(row) : null;
}

export function listSuggestions(db: MaliniDatabase): RoutineSuggestionRecord[] {
	return all<SuggestionRow>(
		db,
		`SELECT ${SUGGESTION_COLUMNS} FROM routine_suggestions ORDER BY created_at, id`,
	).map(suggestionFromRow);
}

export function setSuggestionStatus(
	db: MaliniDatabase,
	suggestionId: string,
	status: RoutineSuggestionStatus,
	updatedAt: string,
): RoutineSuggestionRecord {
	const { changes } = run(
		db,
		'UPDATE routine_suggestions SET status = ?, updated_at = ? WHERE id = ?',
		status,
		updatedAt,
		suggestionId,
	);
	if (changes === 0) throw invariant(`suggestion \`${suggestionId}\` not found`);
	const updated = getSuggestion(db, suggestionId);
	if (!updated) throw invariant(`suggestion \`${suggestionId}\` not found`);
	return updated;
}

function routineFromRow(row: RoutineRow): RoutineRecord {
	return {
		id: row.id,
		status: row.status,
		origin: row.origin,
		label: row.label,
		when: row.trigger_when,
		run: parseJsonColumn<RoutineRun>(row.run_json, `routine \`${row.id}\` run`),
		evidence: parseJsonColumn<RoutineEvidence[]>(
			row.evidence_json,
			`routine \`${row.id}\` evidence`,
		),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function gatedRunFromRow(row: GatedRunRow): RoutineGatedRunRecord {
	return {
		id: row.id,
		routineId: row.routine_id,
		workstreamId: row.workstream_id,
		runKey: row.run_key,
		event: row.event,
		payload: parseJsonColumn<RoutineGatedRunRecord['payload']>(
			row.payload_json,
			`gated run \`${row.id}\` payload`,
		),
		state: row.state,
		createdAt: row.created_at,
		decidedAt: row.decided_at,
	};
}

function suggestionFromRow(row: SuggestionRow): RoutineSuggestionRecord {
	return {
		id: row.id,
		clusterKey: row.cluster_key,
		status: row.status,
		evidence: parseJsonColumn<RoutinePromptEvidence[]>(
			row.evidence_json,
			`suggestion \`${row.id}\` evidence`,
		),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseJsonColumn<Value>(text: string, what: string): Value;
function parseJsonColumn(text: string, what: string): unknown {
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed;
	} catch {
		throw invariant(`${what} is not valid JSON`);
	}
}
