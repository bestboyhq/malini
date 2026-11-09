import type {
	ShipNeedsYou,
	ShipNeedsYouReason,
	ShipPhase,
	ShipStateRecord,
	ShipStep,
	ShipWaitsFor,
} from '$contract/pull-requests';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, nowIso8601, run, type BindValue } from '$main/db/rows';
import { invariant } from '$main/errors';
import { shipPhaseMoves, signatureChecks, type FixAttempts } from '../domain/shipping';

export type ShipRequest = 'push' | 'review';

export type ShipRequests = Readonly<Record<ShipRequest, number>>;

export type ChecksRerun = Readonly<{ headSha: string; at: string }>;

export type ShipPhaseMove = Readonly<{ from: ShipPhase; to: ShipPhase }>;

export type ShipRow = ShipStateRecord &
	Readonly<{
		failureSignature: string | null;
		fixAttempts: FixAttempts;
		checksRerun: ChecksRerun | null;
		generatedTitle: string | null;
		generatedBody: string | null;
		addressedReviews: readonly string[];
		requests: ShipRequests;
		settledAutomationRunId: string | null;
	}>;

export type ShipPatch = Partial<
	Readonly<{
		phase: ShipPhase;
		step: ShipStep | null;
		keep: boolean;
		pullRequestNumber: number | null;
		pullRequestUrl: string | null;
		needsYou: ShipNeedsYou | null;
		queuedAt: string | null;
		failureSignature: string | null;
		checksRerun: ChecksRerun | null;
		fixAttempts: FixAttempts;
		activeAutomationRunId: string | null;
		lastError: string | null;
		githubSaid: string | null;
		failedSince: string | null;
		nextAttemptAt: string | null;
		waitsFor: ShipWaitsFor | null;
		generatedTitle: string | null;
		generatedBody: string | null;
		addressedReviews: readonly string[];
		failures: number;
		settledAutomationRunId: string | null;
	}>
>;

interface ShipDbRow {
	workstream_id: string;
	phase: string;
	step: string | null;
	keep_workstream: number;
	pull_request_number: number | null;
	pull_request_url: string | null;
	needs_you_reason: string | null;
	needs_you_detail: string | null;
	needs_you_automation_run_id: string | null;
	queued_at: string | null;
	failure_signature: string | null;
	checks_rerun_at: string | null;
	checks_rerun_head_sha: string | null;
	fix_attempts: string;
	active_automation_run_id: string | null;
	last_error: string | null;
	github_said: string | null;
	failed_since: string | null;
	next_attempt_at: string | null;
	waits_for: string | null;
	generated_title: string | null;
	generated_body: string | null;
	addressed_reviews: string;
	push_requests: number;
	review_requests: number;
	failures: number;
	settled_automation_run_id: string | null;
	updated_at: string;
}

const PHASES: readonly ShipPhase[] = ['local', 'draft', 'queued', 'needs-you'];
const STEPS: readonly ShipStep[] = [
	'waiting-for-agent',
	'opening-draft',
	'pushing',
	'marking-ready',
	'updating-branch',
	'updating-from-main',
	'resolving-conflicts',
	'rerunning-checks',
	'fixing-checks',
	'addressing-review',
	'waiting-for-checks',
	'waiting-for-review',
	'waiting-for-github',
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
const WAITS: readonly ShipWaitsFor[] = ['workflow-scope', 'workflow-permission', 'push-access'];

const COLUMNS = `workstream_id, phase, step, keep_workstream, pull_request_number, pull_request_url, needs_you_reason,
	needs_you_detail, needs_you_automation_run_id, queued_at, failure_signature, fix_attempts, active_automation_run_id,
	last_error, github_said, failed_since, next_attempt_at, waits_for, generated_title, generated_body,
	addressed_reviews, push_requests, review_requests, failures, settled_automation_run_id, updated_at,
	checks_rerun_at, checks_rerun_head_sha`;

const REQUEST_COLUMNS: Readonly<Record<ShipRequest, string>> = {
	push: 'push_requests',
	review: 'review_requests',
};

function member<T extends string>(values: readonly T[], value: string | null): T | null {
	return values.find((candidate) => candidate === value) ?? null;
}

function fromRow(row: ShipDbRow): ShipRow {
	const reason = member(REASONS, row.needs_you_reason);
	const fixAttempts = attemptCounts(row.fix_attempts);
	return {
		workstreamId: row.workstream_id,
		phase: member(PHASES, row.phase) ?? 'local',
		step: member(STEPS, row.step),
		keep: row.keep_workstream === 1,
		pullRequestNumber: row.pull_request_number,
		pullRequestUrl: row.pull_request_url,
		needsYou:
			reason === null
				? null
				: {
						reason,
						detail: row.needs_you_detail ?? '',
						automationRunId: row.needs_you_automation_run_id,
					},
		queuedAt: row.queued_at,
		attempts: row.failure_signature === null ? 0 : (fixAttempts.get(row.failure_signature) ?? 0),
		checks: signatureChecks(row.failure_signature),
		activeAutomationRunId: row.active_automation_run_id,
		lastError: row.last_error,
		githubSaid: row.github_said,
		failures: row.failures,
		failedSince: row.failed_since,
		nextAttemptAt: row.next_attempt_at,
		waitsFor: member(WAITS, row.waits_for),
		updatedAt: row.updated_at,
		failureSignature: row.failure_signature,
		fixAttempts,
		checksRerun:
			row.checks_rerun_at === null || row.checks_rerun_head_sha === null
				? null
				: { headSha: row.checks_rerun_head_sha, at: row.checks_rerun_at },
		generatedTitle: row.generated_title,
		generatedBody: row.generated_body,
		addressedReviews: reviewIds(row.addressed_reviews),
		requests: {
			push: row.push_requests,
			review: row.review_requests,
		},
		settledAutomationRunId: row.settled_automation_run_id,
	};
}

function attemptCounts(json: string): FixAttempts {
	try {
		const parsed: unknown = JSON.parse(json);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map();
		return new Map(
			Object.entries(parsed).filter(
				(entry): entry is [string, number] => typeof entry[1] === 'number',
			),
		);
	} catch {
		return new Map();
	}
}

function reviewIds(json: string): readonly string[] {
	try {
		const parsed: unknown = JSON.parse(json);
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

export function shipRecord(row: ShipRow): ShipStateRecord {
	return {
		workstreamId: row.workstreamId,
		phase: row.phase,
		step: row.step,
		keep: row.keep,
		pullRequestNumber: row.pullRequestNumber,
		pullRequestUrl: row.pullRequestUrl,
		needsYou: row.needsYou,
		queuedAt: row.queuedAt,
		attempts: row.attempts,
		checks: row.checks,
		activeAutomationRunId: row.activeAutomationRunId,
		lastError: row.lastError,
		githubSaid: row.githubSaid,
		failures: row.failures,
		failedSince: row.failedSince,
		nextAttemptAt: row.nextAttemptAt,
		waitsFor: row.waitsFor,
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

export function insertShip(db: MaliniDatabase, workstreamId: string): void {
	run(
		db,
		`INSERT INTO workstream_ship (workstream_id, phase, updated_at) VALUES (?, 'local', ?)
		 ON CONFLICT(workstream_id) DO NOTHING`,
		workstreamId,
		nowIso8601(),
	);
}

export function updateShip(
	db: MaliniDatabase,
	workstreamId: string,
	patch: ShipPatch,
	phase?: ShipPhase | ShipPhaseMove,
): ShipRow | null {
	const move = typeof phase === 'string' ? { from: phase, to: phase } : phase;
	if (move && !shipPhaseMoves(move.from, move.to)) {
		throw invariant(`a ship cannot move from ${move.from} to ${move.to}`);
	}
	const assignments: string[] = [];
	const values: BindValue[] = [];
	const set = (column: string, value: BindValue): void => {
		assignments.push(`${column} = ?`);
		values.push(value);
	};
	if (move && move.to !== move.from) set('phase', move.to);
	if (patch.step !== undefined) set('step', patch.step);
	if (patch.keep !== undefined) set('keep_workstream', patch.keep ? 1 : 0);
	if (patch.pullRequestNumber !== undefined) set('pull_request_number', patch.pullRequestNumber);
	if (patch.pullRequestUrl !== undefined) set('pull_request_url', patch.pullRequestUrl);
	if (patch.needsYou !== undefined) {
		set('needs_you_reason', patch.needsYou?.reason ?? null);
		set('needs_you_detail', patch.needsYou?.detail ?? null);
		set('needs_you_automation_run_id', patch.needsYou?.automationRunId ?? null);
	}
	if (patch.queuedAt !== undefined) set('queued_at', patch.queuedAt);
	if (patch.failureSignature !== undefined) set('failure_signature', patch.failureSignature);
	if (patch.checksRerun !== undefined) {
		set('checks_rerun_at', patch.checksRerun?.at ?? null);
		set('checks_rerun_head_sha', patch.checksRerun?.headSha ?? null);
	}
	if (patch.fixAttempts !== undefined) {
		set('fix_attempts', JSON.stringify(Object.fromEntries(patch.fixAttempts)));
	}
	if (patch.activeAutomationRunId !== undefined)
		set('active_automation_run_id', patch.activeAutomationRunId);
	if (patch.lastError !== undefined) set('last_error', patch.lastError);
	if (patch.githubSaid !== undefined) set('github_said', patch.githubSaid);
	if (patch.failedSince !== undefined) set('failed_since', patch.failedSince);
	if (patch.nextAttemptAt !== undefined) set('next_attempt_at', patch.nextAttemptAt);
	if (patch.waitsFor !== undefined) set('waits_for', patch.waitsFor);
	if (patch.generatedTitle !== undefined) set('generated_title', patch.generatedTitle);
	if (patch.generatedBody !== undefined) set('generated_body', patch.generatedBody);
	if (patch.addressedReviews !== undefined) {
		set('addressed_reviews', JSON.stringify(patch.addressedReviews));
	}
	if (patch.failures !== undefined) set('failures', patch.failures);
	if (patch.settledAutomationRunId !== undefined)
		set('settled_automation_run_id', patch.settledAutomationRunId);
	set('updated_at', nowIso8601());
	const phaseGuard = move === undefined ? '' : ' AND phase = ?';
	const { changes } = run(
		db,
		`UPDATE workstream_ship SET ${assignments.join(', ')} WHERE workstream_id = ?${phaseGuard}`,
		...values,
		workstreamId,
		...(move === undefined ? [] : [move.from]),
	);
	return changes === 0 ? null : getShip(db, workstreamId);
}

export function deleteShip(db: MaliniDatabase, workstreamId: string): boolean {
	return run(db, 'DELETE FROM workstream_ship WHERE workstream_id = ?', workstreamId).changes > 0;
}

export function requestShip(db: MaliniDatabase, workstreamId: string, request: ShipRequest): void {
	const column = REQUEST_COLUMNS[request];
	run(
		db,
		`UPDATE workstream_ship SET ${column} = ${column} + 1 WHERE workstream_id = ?`,
		workstreamId,
	);
}

export function settleShipRequest(
	db: MaliniDatabase,
	workstreamId: string,
	request: ShipRequest,
	seen: number,
): void {
	if (seen === 0) return;
	const column = REQUEST_COLUMNS[request];
	run(
		db,
		`UPDATE workstream_ship SET ${column} = 0 WHERE workstream_id = ? AND ${column} = ?`,
		workstreamId,
		seen,
	);
}

export function clearShipRequests(db: MaliniDatabase, workstreamId: string): void {
	run(
		db,
		'UPDATE workstream_ship SET push_requests = 0, review_requests = 0 WHERE workstream_id = ?',
		workstreamId,
	);
}
