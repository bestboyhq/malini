import type { JobRunStatus, ShippingJobBuiltin } from '$contract/jobs';
import type {
	PullRequestChangedEvent,
	PullRequestFailedCheck,
	PullRequestMergeability,
	PullRequestReviewItem,
	ShipNeedsYouReason,
	ShipPhase,
	ShipStateRecord,
	ShipStep,
} from '$contract/pull-requests';
import type {
	PullRequestCheckDto,
	PullRequestStatusDto,
	ReviewFeedbackDto,
	WorktreeStatus,
} from '$contract/repositories';

export type PullRequestFacts = PullRequestChangedEvent;

export type ShippingJob = Readonly<{ builtin: ShippingJobBuiltin | null; status: JobRunStatus }>;

export type ShippingWorktree = Pick<
	WorktreeStatus,
	| 'dirtyPaths'
	| 'conflictedPaths'
	| 'conflictMarkerPaths'
	| 'ahead'
	| 'hasUpstream'
	| 'operationInProgress'
>;

export type ShippingSnapshot = Readonly<{
	phase: ShipPhase;
	pushRequested: boolean;
	updateRequested: boolean;
	reviewRequested: boolean;
	addressedReviews: readonly string[];
	behindBase: number | null;
	pullRequestNumber: number | null;
	idle: boolean;
	job: ShippingJob | null;
	lastJobRunId: string | null;
	lastJobBuiltin: ShippingJobBuiltin | null;
	settledJob: ShippingJobBuiltin | null;
	worktree: ShippingWorktree;
	threadResolutionRunId: string | null;
	failureSignature: string | null;
	fixSucceededAt: number | null;
	attempts: number;
	fixAttemptLimit: number;
	backoffUntil: number | null;
	now: number;
	read: boolean;
	pullRequest: PullRequestFacts | null;
}>;

export type ShippingMove =
	| Readonly<{ kind: 'idle'; problem: string | null }>
	| Readonly<{ kind: 'wait'; step: ShipStep; until?: number }>
	| Readonly<{ kind: 'backoff' }>
	| Readonly<{ kind: 'read-pull-request' }>
	| Readonly<{ kind: 'read-base' }>
	| Readonly<{ kind: 'commit' }>
	| Readonly<{ kind: 'push' }>
	| Readonly<{ kind: 'open-draft' }>
	| Readonly<{ kind: 'mark-ready' }>
	| Readonly<{ kind: 'update-branch' }>
	| Readonly<{ kind: 'run-job'; builtin: ShippingJobBuiltin; signature: string; attempt: number }>
	| Readonly<{ kind: 'resolve-threads'; agentRunId: string }>
	| Readonly<{ kind: 'merge'; method: string; headSha: string }>
	| Readonly<{ kind: 'land' }>
	| Readonly<{
			kind: 'needs-you';
			reason: ShipNeedsYouReason;
			detail: string;
			jobRunId: string | null;
	  }>;

export type ReviewRouting = Readonly<{
	botThreads: readonly PullRequestReviewItem[];
	botChangeRequests: readonly PullRequestReviewItem[];
	humanThreads: readonly PullRequestReviewItem[];
	humanChangeRequests: readonly PullRequestReviewItem[];
}>;

export type ReviewToAddress = Readonly<{
	changeRequests: readonly PullRequestReviewItem[];
	threads: readonly PullRequestReviewItem[];
}>;

export const DEFAULT_SHIP_DELAYS = Object.freeze({
	idleDebounceMs: 5_000,
	checksPollMs: 45_000,
	reviewPollMs: 120_000,
	githubPollMs: 15_000,
	openedCheckMs: 60_000,
	backoffBaseMs: 30_000,
	backoffCapMs: 600_000,
});

export type ShipDelays = Readonly<{ [Key in keyof typeof DEFAULT_SHIP_DELAYS]: number }>;

export function scaledShipDelays(scale: number): ShipDelays {
	const scaled = (ms: number): number => Math.round(ms * scale);
	const delays = DEFAULT_SHIP_DELAYS;
	return {
		idleDebounceMs: scaled(delays.idleDebounceMs),
		checksPollMs: scaled(delays.checksPollMs),
		reviewPollMs: scaled(delays.reviewPollMs),
		githubPollMs: scaled(delays.githubPollMs),
		openedCheckMs: scaled(delays.openedCheckMs),
		backoffBaseMs: scaled(delays.backoffBaseMs),
		backoffCapMs: scaled(delays.backoffCapMs),
	};
}

const ACTIVE_JOB_STATUSES: ReadonlySet<JobRunStatus> = new Set(['queued', 'running', 'needs-you']);
const FAILED_CHECK_STATES = new Set([
	'FAILURE',
	'ERROR',
	'CANCELLED',
	'TIMED_OUT',
	'STARTUP_FAILURE',
	'ACTION_REQUIRED',
]);
const PENDING_CHECK_STATES = new Set([
	'PENDING',
	'QUEUED',
	'IN_PROGRESS',
	'WAITING',
	'REQUESTED',
	'EXPECTED',
]);
const READY_MERGE_STATES = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);
const MERGEABILITIES: readonly PullRequestMergeability[] = [
	'ready',
	'conflicts',
	'behind',
	'blocked',
	'unknown',
];
const PULL_REQUEST_STATES: readonly PullRequestFacts['state'][] = [
	'open',
	'draft',
	'closed',
	'merged',
];
const CHECKS_STATES: readonly PullRequestFacts['checks'][] = [
	'none',
	'success',
	'pending',
	'failed',
	'unknown',
];
const REVIEW_DECISIONS: readonly NonNullable<PullRequestFacts['reviewDecision']>[] = [
	'approved',
	'changes_requested',
	'review_required',
];
export const CHECKS_RERUN_GRACE_MS = 60_000;
const JOB_STEPS: Readonly<Record<ShippingJobBuiltin, ShipStep>> = {
	'fix-checks': 'fixing-checks',
	'update-from-main': 'updating-from-main',
	'resolve-conflicts': 'resolving-conflicts',
	'address-review': 'addressing-review',
};
const JOB_LABELS: Readonly<Record<ShippingJobBuiltin, string>> = {
	'fix-checks': 'Fixing the checks',
	'update-from-main': 'Updating from main',
	'resolve-conflicts': 'Resolving conflicts',
	'address-review': 'Addressing the review',
};

export function nextShippingMove(snapshot: ShippingSnapshot): ShippingMove {
	if (snapshot.phase === 'needs-you') return { kind: 'idle', problem: null };
	if (snapshot.backoffUntil !== null && snapshot.backoffUntil > snapshot.now) {
		return { kind: 'backoff' };
	}
	return snapshot.phase === 'queued' ? queuedMove(snapshot) : workingMove(snapshot);
}

export function jobIsActive(job: ShippingJob | null): boolean {
	return job !== null && ACTIVE_JOB_STATUSES.has(job.status);
}

export function isUpdateJob(builtin: ShippingJobBuiltin | null): boolean {
	return builtin === 'update-from-main' || builtin === 'resolve-conflicts';
}

export function jobStep(builtin: ShippingJobBuiltin | null): ShipStep {
	return builtin === null ? 'waiting-for-agent' : JOB_STEPS[builtin];
}

export function blockingFailedChecks(
	pullRequest: PullRequestStatusDto,
): readonly PullRequestCheckDto[] {
	return pullRequest.checks.filter(
		(check) =>
			check.required !== false &&
			check.notStartedReason === null &&
			FAILED_CHECK_STATES.has(checkState(check)),
	);
}

export function pullRequestChange(
	workstreamId: string,
	pullRequest: PullRequestStatusDto,
	feedback: ReviewFeedbackDto | null,
): PullRequestChangedEvent | null {
	const { state, number } = pullRequest;
	if (state === 'not_open' || number === null) return null;
	if (state === 'open' && pullRequest.includesLocalHead === false) return null;
	const failing = pullRequest.checks.filter((check) => FAILED_CHECK_STATES.has(checkState(check)));
	const reviewed = needsReviewFeedback(pullRequest);
	const merging = mergeability(pullRequest);
	return {
		workstreamId,
		pullRequestNumber: number,
		pullRequestUrl: pullRequest.url,
		state: state === 'open' && pullRequest.draft === true ? 'draft' : state,
		baseBranch: pullRequest.baseRef,
		headSha: pullRequest.headSha,
		checks: pullRequest.checksState,
		checksPending: checksPending(pullRequest),
		failingChecks: [...new Set(failing.map((check) => check.name))].sort(),
		blockingChecks: distinct(
			blockingFailedChecks(pullRequest).map((check): PullRequestFailedCheck => ({
				name: check.name,
				state: checkState(check),
				required: check.required,
				appId: check.appId,
				completedAt: check.completedAt,
			})),
		).sort(byName),
		reviewDecision: pullRequest.reviewDecision,
		unresolvedThreads: pullRequest.unresolvedReviewThreadCount,
		changeRequests: reviewed ? changeRequestItems(feedback) : [],
		threads: reviewed ? threadItems(feedback) : [],
		behindBase: pullRequest.behindBase,
		conflicts: merging === 'conflicts',
		mergeability: merging,
		viewerCanMerge: pullRequest.viewerCanMerge,
		mergeMethod: mergeMethod(pullRequest),
	};
}

export function pullRequestFacts(payload: unknown): PullRequestFacts | null {
	if (!isObject(payload)) return null;
	const state = member(PULL_REQUEST_STATES, payload['state']);
	const checks = member(CHECKS_STATES, payload['checks']);
	const merging = member(MERGEABILITIES, payload['mergeability']);
	const workstreamId = payload['workstreamId'];
	const pullRequestNumber = payload['pullRequestNumber'];
	const blocking = failedChecks(payload['blockingChecks']);
	const changeRequests = reviewItems(payload['changeRequests']);
	const threads = reviewItems(payload['threads']);
	if (
		state === null ||
		checks === null ||
		merging === null ||
		typeof workstreamId !== 'string' ||
		typeof pullRequestNumber !== 'number' ||
		blocking === null ||
		changeRequests === undefined ||
		threads === undefined ||
		typeof payload['checksPending'] !== 'boolean'
	) {
		return null;
	}
	return {
		workstreamId,
		pullRequestNumber,
		pullRequestUrl: stringOrNull(payload['pullRequestUrl']),
		state,
		baseBranch: stringOrNull(payload['baseBranch']) ?? '',
		headSha: stringOrNull(payload['headSha']),
		checks,
		checksPending: payload['checksPending'],
		failingChecks: strings(payload['failingChecks']),
		blockingChecks: blocking,
		reviewDecision: member(REVIEW_DECISIONS, payload['reviewDecision']),
		unresolvedThreads: numberOrNull(payload['unresolvedThreads']),
		changeRequests,
		threads,
		behindBase: numberOrNull(payload['behindBase']),
		conflicts: payload['conflicts'] === true,
		mergeability: merging,
		viewerCanMerge:
			typeof payload['viewerCanMerge'] === 'boolean' ? payload['viewerCanMerge'] : null,
		mergeMethod: stringOrNull(payload['mergeMethod']),
	};
}

export function reviewRouting(pullRequest: PullRequestFacts | null): ReviewRouting {
	const threads = pullRequest?.threads ?? [];
	const changeRequests = pullRequest?.changeRequests ?? [];
	return {
		botThreads: threads.filter((thread) => thread.bot),
		botChangeRequests: changeRequests.filter((review) => review.bot),
		humanThreads: threads.filter((thread) => !thread.bot),
		humanChangeRequests: changeRequests.filter((review) => !review.bot),
	};
}

export function reviewToAddress(
	pullRequest: PullRequestFacts,
	addressedReviews: readonly string[],
): ReviewToAddress {
	const routing = reviewRouting(pullRequest);
	const addressed = new Set(addressedReviews);
	const changeRequests =
		pullRequest.reviewDecision === 'changes_requested'
			? (pullRequest.changeRequests ?? []).filter((review) => !addressed.has(review.id))
			: [];
	const reviewers = new Set(changeRequests.flatMap((review) => (review.by ? [review.by] : [])));
	const reviewerThreads = routing.humanThreads.filter((thread) => reviewers.has(thread.by ?? ''));
	return { changeRequests, threads: [...routing.botThreads, ...reviewerThreads] };
}

export function reviewFeedbackToAddress(
	feedback: ReviewFeedbackDto,
	review: ReviewToAddress,
): ReviewFeedbackDto {
	const threads = new Set(review.threads.map((thread) => thread.id));
	const changeRequests = new Set(review.changeRequests.map((request) => request.id));
	return {
		...feedback,
		unresolvedThreads: (feedback.unresolvedThreads ?? []).filter((thread) =>
			threads.has(thread.id),
		),
		requestedChangeReviews: (feedback.requestedChangeReviews ?? []).filter((request) =>
			changeRequests.has(request.id),
		),
	};
}

export function reviewSignature(review: ReviewToAddress): string {
	return `${REVIEW_SIGNATURE_PREFIX}${JSON.stringify({
		changeRequests: sortedIds(review.changeRequests),
		threads: sortedIds(review.threads),
	})}`;
}

export function addressedChangeRequests(signature: string | null): readonly string[] {
	if (!signature?.startsWith(REVIEW_SIGNATURE_PREFIX)) return [];
	try {
		const parsed: unknown = JSON.parse(signature.slice(REVIEW_SIGNATURE_PREFIX.length));
		if (typeof parsed !== 'object' || parsed === null || !('changeRequests' in parsed)) return [];
		const ids: unknown = parsed.changeRequests;
		return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

const REVIEW_SIGNATURE_PREFIX = 'review:';

function sortedIds(items: readonly Readonly<{ id: string }>[]): readonly string[] {
	return [...new Set(items.map((item) => item.id))].sort();
}

export function needsReviewFeedback(pullRequest: PullRequestStatusDto): boolean {
	return (
		pullRequest.state === 'open' &&
		((pullRequest.unresolvedReviewThreadCount ?? 0) > 0 ||
			pullRequest.reviewDecision === 'changes_requested')
	);
}

export function shipBackoffMs(failures: number, delays: ShipDelays): number {
	const doublings = Math.max(0, Math.min(failures - 1, 30));
	return Math.min(delays.backoffBaseMs * 2 ** doublings, delays.backoffCapMs);
}

export function clampedFixAttempts(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 20) : fallback;
}

export function pullRequestReadEvery(
	state: Pick<ShipStateRecord, 'phase' | 'step' | 'activeJobRunId'>,
	delays: ShipDelays,
): number | null {
	if (state.activeJobRunId !== null) return null;
	if (state.phase === 'needs-you') return delays.reviewPollMs;
	if (state.phase !== 'queued') {
		return state.step === 'waiting-for-github' ? delays.githubPollMs : null;
	}
	switch (state.step) {
		case 'waiting-for-agent':
		case 'fixing-checks':
		case 'updating-from-main':
		case 'resolving-conflicts':
		case 'addressing-review':
			return null;
		case 'waiting-for-checks':
			return delays.checksPollMs;
		case 'waiting-for-review':
			return delays.reviewPollMs;
		default:
			return delays.githubPollMs;
	}
}

export function readsBehindBase(pullRequest: PullRequestFacts): boolean {
	return (
		pullRequest.state !== 'closed' &&
		pullRequest.state !== 'merged' &&
		((pullRequest.behindBase ?? 0) > 0 || pullRequest.conflicts)
	);
}

function workingMove(snapshot: ShippingSnapshot): ShippingMove {
	const { worktree } = snapshot;
	if (jobIsActive(snapshot.job)) {
		return { kind: 'wait', step: jobStep(snapshot.job?.builtin ?? null) };
	}
	if (!snapshot.pushRequested && !snapshot.updateRequested && !snapshot.reviewRequested) {
		return { kind: 'idle', problem: null };
	}
	if (!snapshot.idle) return { kind: 'wait', step: 'waiting-for-agent' };
	const operation = worktree.operationInProgress;
	if (operation === 'merge' && isUpdateJob(snapshot.lastJobBuiltin)) {
		if (worktree.conflictedPaths.length > 0 && !conflictsResolved(snapshot)) {
			return withoutNeedsYou(resolveConflictsMove(snapshot));
		}
		return saveMove(snapshot);
	}
	if (operation !== null) {
		return {
			kind: 'idle',
			problem: `A ${operation} is in progress in this workstream. Finish or abort it, then try again.`,
		};
	}
	if (snapshot.pushRequested && hasUnsavedWork(snapshot)) return saveMove(snapshot);
	if (snapshot.threadResolutionRunId !== null && snapshot.pullRequestNumber !== null) {
		return { kind: 'resolve-threads', agentRunId: snapshot.threadResolutionRunId };
	}
	const update: ShippingMove = snapshot.updateRequested
		? updateMove(snapshot)
		: { kind: 'idle', problem: null };
	if (update.kind !== 'idle' || !snapshot.reviewRequested) return update;
	return reviewMove(snapshot);
}

function reviewMove(snapshot: ShippingSnapshot): ShippingMove {
	if (snapshot.worktree.dirtyPaths.length > 0) return { kind: 'idle', problem: null };
	if (!snapshot.read) return { kind: 'read-pull-request' };
	const pullRequest = snapshot.pullRequest;
	if (pullRequest === null || (pullRequest.state !== 'open' && pullRequest.state !== 'draft')) {
		return { kind: 'idle', problem: null };
	}
	const review = reviewToAddress(pullRequest, snapshot.addressedReviews);
	if (review.changeRequests.length === 0) return { kind: 'idle', problem: null };
	return withoutNeedsYou(fixJob(snapshot, 'address-review', reviewSignature(review)));
}

function updateMove(snapshot: ShippingSnapshot): ShippingMove {
	const dirty = snapshot.worktree.dirtyPaths.length > 0;
	if (dirty && snapshot.phase !== 'local') return { kind: 'idle', problem: null };
	if (snapshot.behindBase === null) return { kind: 'read-base' };
	if (snapshot.behindBase === 0) return { kind: 'idle', problem: null };
	if (!snapshot.read) return { kind: 'read-pull-request' };
	const finished =
		snapshot.pullRequest?.state === 'merged' || snapshot.pullRequest?.state === 'closed';
	if (finished) return { kind: 'idle', problem: null };
	if (dirty) return { kind: 'commit' };
	return { kind: 'run-job', builtin: 'update-from-main', signature: 'update', attempt: 1 };
}

function hasUnsavedWork(snapshot: ShippingSnapshot): boolean {
	return snapshot.phase === 'local'
		? snapshot.worktree.dirtyPaths.length > 0
		: snapshot.pullRequestNumber === null || hasUnpushedWork(snapshot.worktree);
}

function saveMove(snapshot: ShippingSnapshot): ShippingMove {
	if (snapshot.phase === 'local') return { kind: 'commit' };
	return snapshot.pullRequestNumber === null ? { kind: 'open-draft' } : { kind: 'push' };
}

function withoutNeedsYou(move: ShippingMove): ShippingMove {
	return move.kind === 'needs-you' ? { kind: 'idle', problem: move.detail } : move;
}

function queuedMove(snapshot: ShippingSnapshot): ShippingMove {
	const { worktree } = snapshot;
	if (jobIsActive(snapshot.job)) {
		return { kind: 'wait', step: jobStep(snapshot.job?.builtin ?? null) };
	}
	if (!snapshot.idle) return { kind: 'wait', step: 'waiting-for-agent' };
	const operation = worktree.operationInProgress;
	if (operation !== null && operation !== 'merge') {
		return needsYou(
			snapshot,
			'operation-in-progress',
			`A ${operation} is in progress in this workstream. Finish or abort it, then retry.`,
		);
	}
	if (
		operation === 'merge' &&
		worktree.conflictedPaths.length > 0 &&
		!conflictsResolved(snapshot)
	) {
		return resolveConflictsMove(snapshot);
	}
	if (snapshot.pullRequestNumber === null) return { kind: 'open-draft' };
	if (operation === 'merge' || hasUnpushedWork(worktree)) return { kind: 'push' };
	if (snapshot.threadResolutionRunId !== null) {
		return { kind: 'resolve-threads', agentRunId: snapshot.threadResolutionRunId };
	}
	if (!snapshot.read) return { kind: 'read-pull-request' };
	const pullRequest = snapshot.pullRequest;
	if (pullRequest === null) return { kind: 'open-draft' };
	return pullRequestMove(snapshot, pullRequest);
}

function pullRequestMove(snapshot: ShippingSnapshot, pullRequest: PullRequestFacts): ShippingMove {
	if (pullRequest.state === 'merged') return { kind: 'land' };
	if (pullRequest.state === 'closed') {
		return needsYou(
			snapshot,
			'pull-request-closed',
			`Pull request #${pullRequest.pullRequestNumber} was closed without merging.`,
		);
	}
	if (pullRequest.state === 'draft') return { kind: 'mark-ready' };
	const merging = pullRequest.mergeability;
	if (merging === 'conflicts' || merging === 'behind') return { kind: 'update-branch' };
	if (pullRequest.blockingChecks.length > 0) {
		return failingChecksMove(snapshot, pullRequest.blockingChecks);
	}
	if (pullRequest.checksPending) return { kind: 'wait', step: 'waiting-for-checks' };
	const toAddress = reviewToAddress(pullRequest, snapshot.addressedReviews);
	if (toAddress.threads.length > 0 || toAddress.changeRequests.length > 0) {
		return fixJob(snapshot, 'address-review', reviewSignature(toAddress));
	}
	const review = reviewRouting(pullRequest);
	if (merging === 'blocked') return blockedMove(snapshot, pullRequest, review);
	if (pullRequest.viewerCanMerge === false) return notPermitted(snapshot);
	if (merging === 'unknown' || !pullRequest.headSha) {
		return { kind: 'wait', step: 'waiting-for-github' };
	}
	const method = pullRequest.mergeMethod;
	if (method === null) {
		return pullRequest.viewerCanMerge === null
			? { kind: 'wait', step: 'waiting-for-github' }
			: needsYou(
					snapshot,
					'merge-not-permitted',
					'This repository allows no merge method Malini can use.',
				);
	}
	return { kind: 'merge', method, headSha: pullRequest.headSha };
}

function failingChecksMove(
	snapshot: ShippingSnapshot,
	failing: readonly PullRequestFailedCheck[],
): ShippingMove {
	const failure = signature(
		'checks',
		failing.map((check) => check.name),
	);
	const fixedAt = snapshot.failureSignature === failure ? snapshot.fixSucceededAt : null;
	if (fixedAt === null || failing.some((check) => completedAfter(check, fixedAt))) {
		return fixJob(snapshot, 'fix-checks', failure);
	}
	if (snapshot.now - fixedAt < CHECKS_RERUN_GRACE_MS) {
		return { kind: 'wait', step: 'waiting-for-checks', until: fixedAt + CHECKS_RERUN_GRACE_MS };
	}
	return needsYou(
		snapshot,
		'fix-gave-up',
		'The failing checks did not run again after the last fix.',
	);
}

function completedAfter(check: PullRequestFailedCheck, time: number): boolean {
	const completed = Date.parse(check.completedAt ?? '');
	return Number.isNaN(completed) || completed > time;
}

function blockedMove(
	snapshot: ShippingSnapshot,
	pullRequest: PullRequestFacts,
	review: ReviewRouting,
): ShippingMove {
	if (pullRequest.reviewDecision === 'changes_requested') {
		return review.humanThreads.length > 0
			? needsYou(snapshot, 'reply-to-reviewer', reviewerDetail(review))
			: { kind: 'wait', step: 'waiting-for-review' };
	}
	if (pullRequest.reviewDecision === 'review_required') {
		return { kind: 'wait', step: 'waiting-for-review' };
	}
	if (review.humanThreads.length > 0) {
		return needsYou(snapshot, 'reply-to-reviewer', reviewerDetail(review));
	}
	if (pullRequest.viewerCanMerge === false) return notPermitted(snapshot);
	if (pullRequest.checks === 'none') {
		return { kind: 'wait', step: 'waiting-for-checks' };
	}
	return needsYou(
		snapshot,
		'merge-not-permitted',
		'GitHub blocks this merge. Check the branch rules on GitHub.',
	);
}

function reviewerDetail(review: ReviewRouting): string {
	const logins = [
		...new Set(
			review.humanChangeRequests.flatMap((request) => (request.by ? [`@${request.by}`] : [])),
		),
	];
	if (logins.length > 0) return `${logins.join(', ')} requested changes.`;
	return 'A reviewer left comments that block the merge.';
}

function notPermitted(snapshot: ShippingSnapshot): ShippingMove {
	return needsYou(
		snapshot,
		'merge-not-permitted',
		'You do not have permission to merge this pull request.',
	);
}

function fixJob(
	snapshot: ShippingSnapshot,
	builtin: ShippingJobBuiltin,
	failure: string,
): ShippingMove {
	const repeated = snapshot.failureSignature === failure;
	if (repeated && snapshot.attempts >= snapshot.fixAttemptLimit) {
		const tries = snapshot.attempts === 1 ? 'once' : `${snapshot.attempts} times`;
		return needsYou(
			snapshot,
			'fix-gave-up',
			`${JOB_LABELS[builtin]} did not work. Malini tried ${tries}.`,
		);
	}
	return {
		kind: 'run-job',
		builtin,
		signature: failure,
		attempt: repeated ? snapshot.attempts + 1 : 1,
	};
}

function needsYou(
	snapshot: ShippingSnapshot,
	reason: ShipNeedsYouReason,
	detail: string,
): ShippingMove {
	return {
		kind: 'needs-you',
		reason,
		detail,
		jobRunId: reason === 'fix-gave-up' ? snapshot.lastJobRunId : null,
	};
}

function signature(kind: string, parts: readonly string[]): string {
	return `${kind}:${JSON.stringify([...new Set(parts)].sort())}`;
}

function resolveConflictsMove(snapshot: ShippingSnapshot): ShippingMove {
	return fixJob(
		snapshot,
		'resolve-conflicts',
		signature('conflicts', snapshot.worktree.conflictedPaths),
	);
}

function conflictsResolved(snapshot: ShippingSnapshot): boolean {
	return (
		snapshot.settledJob === 'resolve-conflicts' &&
		snapshot.worktree.conflictMarkerPaths.length === 0
	);
}

function hasUnpushedWork(worktree: ShippingWorktree): boolean {
	return worktree.dirtyPaths.length > 0 || worktree.ahead > 0 || !worktree.hasUpstream;
}

function mergeability(pullRequest: PullRequestStatusDto): PullRequestMergeability {
	const state = pullRequest.mergeableState?.trim().toUpperCase() ?? '';
	if (pullRequest.mergeable === false || state === 'DIRTY') return 'conflicts';
	if (state === 'BEHIND') return 'behind';
	if (state === 'BLOCKED') return 'blocked';
	return pullRequest.mergeable === true && READY_MERGE_STATES.has(state) ? 'ready' : 'unknown';
}

function checkState(check: PullRequestCheckDto): string {
	return (check.conclusion ?? check.state).toUpperCase();
}

function checksPending(pullRequest: PullRequestStatusDto): boolean {
	return (
		pullRequest.checksState === 'pending' ||
		pullRequest.checks.some((check) => PENDING_CHECK_STATES.has(checkState(check)))
	);
}

function mergeMethod(pullRequest: PullRequestStatusDto): string | null {
	const allowed = pullRequest.allowedMergeMethods;
	if (pullRequest.defaultMergeMethod && allowed.includes(pullRequest.defaultMergeMethod)) {
		return pullRequest.defaultMergeMethod;
	}
	return allowed[0] ?? null;
}

function changeRequestItems(feedback: ReviewFeedbackDto | null): PullRequestReviewItem[] | null {
	const reviews = feedback?.requestedChangeReviews;
	if (!reviews) return null;
	return reviews
		.map((review) => ({ id: review.id, by: review.authorLogin, bot: review.authorIsBot }))
		.sort(byId);
}

function threadItems(feedback: ReviewFeedbackDto | null): PullRequestReviewItem[] | null {
	const threads = feedback?.unresolvedThreads;
	if (!threads) return null;
	return threads
		.map((thread) => ({
			id: thread.id,
			by: thread.comments[0]?.authorLogin ?? null,
			bot: thread.comments[0]?.authorIsBot === true,
		}))
		.sort(byId);
}

function distinct<T>(items: readonly T[]): T[] {
	return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
}

function byId(left: Readonly<{ id: string }>, right: Readonly<{ id: string }>): number {
	return left.id.localeCompare(right.id);
}

function byName(left: PullRequestFailedCheck, right: PullRequestFailedCheck): number {
	return (
		left.name.localeCompare(right.name) ||
		(left.completedAt ?? '').localeCompare(right.completedAt ?? '')
	);
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function member<T extends string>(values: readonly T[], value: unknown): T | null {
	return values.find((candidate) => candidate === value) ?? null;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function failedChecks(value: unknown): PullRequestFailedCheck[] | null {
	if (!Array.isArray(value)) return null;
	return value.flatMap((item): PullRequestFailedCheck[] =>
		isObject(item) && typeof item['name'] === 'string'
			? [
					{
						name: item['name'],
						state: stringOrNull(item['state']) ?? 'FAILURE',
						required: typeof item['required'] === 'boolean' ? item['required'] : null,
						appId: numberOrNull(item['appId']),
						completedAt: stringOrNull(item['completedAt']),
					},
				]
			: [],
	);
}

function reviewItems(value: unknown): PullRequestReviewItem[] | null | undefined {
	if (value === null) return null;
	if (!Array.isArray(value)) return undefined;
	return value.flatMap((item): PullRequestReviewItem[] =>
		isObject(item) && typeof item['id'] === 'string'
			? [{ id: item['id'], by: stringOrNull(item['by']), bot: item['bot'] === true }]
			: [],
	);
}
