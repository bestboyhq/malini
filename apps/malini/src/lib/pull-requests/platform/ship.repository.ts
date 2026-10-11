import type {
	ShipNeedsYou,
	ShipNeedsYouReason,
	ShipPhase,
	ShipStateRecord,
	ShipStep,
} from '$contract/pull-requests';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, nowIso8601, run, type BindValue } from '$main/db/rows';

export type ShipRow = ShipStateRecord &
	Readonly<{
		failureSignature: string | null;
		generatedTitle: string | null;
		generatedBody: string | null;
	}>;

export type ShipPatch = Partial<
	Readonly<{
		phase: ShipPhase;
		step: ShipStep | null;
		pullRequestNumber: number | null;
		pullRequestUrl: string | null;
		needsYou: ShipNeedsYou | null;
		queuedAt: string | null;
		failureSignature: string | null;
		attempts: number;
		activeJobRunId: string | null;
		lastError: string | null;
		nextAttemptAt: string | null;
		generatedTitle: string | null;
		generatedBody: string | null;
	}>
>;

interface ShipDbRow {
	workstream_id: string;
	phase: string;
	step: string | null;
	pull_request_number: number | null;
	pull_request_url: string | null;
	needs_you_reason: string | null;
	needs_you_detail: string | null;
	needs_you_job_run_id: string | null;
	queued_at: string | null;
	failure_signature: string | null;
	attempts: number;
	active_job_run_id: string | null;
	last_error: string | null;
	next_attempt_at: string | null;
	generated_title: string | null;
	generated_body: string | null;
	updated_at: string;
}

const PHASES: readonly ShipPhase[] = ['draft', 'queued', 'needs-you'];
const STEPS: readonly ShipStep[] = [
	'waiting-for-agent',
	'opening-draft',
	'pushing',
	'marking-ready',
	'updating-branch',
	'resolving-conflicts',
	'fixing-checks',
	'addressing-review',
	'waiting-for-checks',
	'waiting-for-review',
	'waiting-for-github',
	'waiting-for-turn',
	'merging',
	'archiving',
];
const REASONS: readonly ShipNeedsYouReason[] = [
	'reply-to-reviewer',
	'fix-gave-up',
	'merge-not-permitted',
	'pull-request-closed',
	'github-reconnect',
	'operation-in-progress',
];

const COLUMNS = `workstream_id, phase, step, pull_request_number, pull_request_url, needs_you_reason,
	needs_you_detail, needs_you_job_run_id, queued_at, failure_signature, attempts, active_job_run_id,
	last_error, next_attempt_at, generated_title, generated_body, updated_at`;

function member<T extends string>(values: readonly T[], value: string | null): T | null {
	return values.find((candidate) => candidate === value) ?? null;
}

function fromRow(row: ShipDbRow): ShipRow {
	const reason = member(REASONS, row.needs_you_reason);
	return {
		workstreamId: row.workstream_id,
		phase: member(PHASES, row.phase) ?? 'draft',
		step: member(STEPS, row.step),
		pullRequestNumber: row.pull_request_number,
		pullRequestUrl: row.pull_request_url,
		needsYou:
			reason === null
				? null
				: {
						reason,
						detail: row.needs_you_detail ?? '',
						jobRunId: row.needs_you_job_run_id,
					},
		queuedAt: row.queued_at,
		attempts: row.attempts,
		activeJobRunId: row.active_job_run_id,
		lastError: row.last_error,
		nextAttemptAt: row.next_attempt_at,
		updatedAt: row.updated_at,
		failureSignature: row.failure_signature,
		generatedTitle: row.generated_title,
		generatedBody: row.generated_body,
	};
}

export function shipRecord(row: ShipRow): ShipStateRecord {
	return {
		workstreamId: row.workstreamId,
		phase: row.phase,
		step: row.step,
		pullRequestNumber: row.pullRequestNumber,
		pullRequestUrl: row.pullRequestUrl,
		needsYou: row.needsYou,
		queuedAt: row.queuedAt,
		attempts: row.attempts,
		activeJobRunId: row.activeJobRunId,
		lastError: row.lastError,
		nextAttemptAt: row.nextAttemptAt,
		updatedAt: row.updatedAt,
	};
}

export function getShip(db: MaliniDatabase, workstreamId: string): ShipRow | null {
	const row = get<ShipDbRow>(
		db,
		`SELECT ${COLUMNS} FROM workstream_ship WHERE workstream_id = ?`,
		workstreamId,
	);
	return row ? fromRow(row) : null;
}

export function listShips(db: MaliniDatabase): ShipRow[] {
	return all<ShipDbRow>(
		db,
		`SELECT ${COLUMNS} FROM workstream_ship ORDER BY queued_at IS NULL, queued_at, workstream_id`,
	).map(fromRow);
}

export function insertShip(db: MaliniDatabase, workstreamId: string, phase: ShipPhase): void {
	run(
		db,
		`INSERT INTO workstream_ship (workstream_id, phase, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(workstream_id) DO NOTHING`,
		workstreamId,
		phase,
		nowIso8601(),
	);
}

export function updateShip(
	db: MaliniDatabase,
	workstreamId: string,
	patch: ShipPatch,
	onlyInPhase?: ShipPhase,
): ShipRow | null {
	const assignments: string[] = [];
	const values: BindValue[] = [];
	const set = (column: string, value: BindValue): void => {
		assignments.push(`${column} = ?`);
		values.push(value);
	};
	if (patch.phase !== undefined) set('phase', patch.phase);
	if (patch.step !== undefined) set('step', patch.step);
	if (patch.pullRequestNumber !== undefined) set('pull_request_number', patch.pullRequestNumber);
	if (patch.pullRequestUrl !== undefined) set('pull_request_url', patch.pullRequestUrl);
	if (patch.needsYou !== undefined) {
		set('needs_you_reason', patch.needsYou?.reason ?? null);
		set('needs_you_detail', patch.needsYou?.detail ?? null);
		set('needs_you_job_run_id', patch.needsYou?.jobRunId ?? null);
	}
	if (patch.queuedAt !== undefined) set('queued_at', patch.queuedAt);
	if (patch.failureSignature !== undefined) set('failure_signature', patch.failureSignature);
	if (patch.attempts !== undefined) set('attempts', patch.attempts);
	if (patch.activeJobRunId !== undefined) set('active_job_run_id', patch.activeJobRunId);
	if (patch.lastError !== undefined) set('last_error', patch.lastError);
	if (patch.nextAttemptAt !== undefined) set('next_attempt_at', patch.nextAttemptAt);
	if (patch.generatedTitle !== undefined) set('generated_title', patch.generatedTitle);
	if (patch.generatedBody !== undefined) set('generated_body', patch.generatedBody);
	set('updated_at', nowIso8601());
	const phaseGuard = onlyInPhase === undefined ? '' : ' AND phase = ?';
	const { changes } = run(
		db,
		`UPDATE workstream_ship SET ${assignments.join(', ')} WHERE workstream_id = ?${phaseGuard}`,
		...values,
		workstreamId,
		...(onlyInPhase === undefined ? [] : [onlyInPhase]),
	);
	return changes === 0 ? null : getShip(db, workstreamId);
}

export function deleteShip(db: MaliniDatabase, workstreamId: string): boolean {
	return run(db, 'DELETE FROM workstream_ship WHERE workstream_id = ?', workstreamId).changes > 0;
}
