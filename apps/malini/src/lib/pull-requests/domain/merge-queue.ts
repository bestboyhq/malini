import type { JobBuiltin, JobRunStatus } from '$contract/jobs';
import type { ShipNeedsYouReason, ShipPhase, ShipStep } from '$contract/pull-requests';
import type {
	PullRequestCheckDto,
	PullRequestStatusDto,
	RequestedChangeReviewDto,
	ReviewFeedbackDto,
	ReviewThreadDto,
	WorktreeStatus,
} from '$contract/repositories';

export type MergeQueueJob = Readonly<{ builtin: JobBuiltin | null; status: JobRunStatus }>;

export type MergeQueueWorktree = Pick<
	WorktreeStatus,
	| 'dirtyPaths'
	| 'conflictedPaths'
	| 'conflictMarkerPaths'
	| 'ahead'
	| 'hasUpstream'
	| 'operationInProgress'
>;

export type MergeQueueSnapshot = Readonly<{
	phase: ShipPhase;
	pushRequested: boolean;
	pullRequestNumber: number | null;
	idle: boolean;
	job: MergeQueueJob | null;
	lastJobRunId: string | null;
	settledJob: JobBuiltin | null;
	worktree: MergeQueueWorktree;
	threadResolutionRunId: string | null;
	failureSignature: string | null;
	attempts: number;
	fixAttemptLimit: number;
	backoffUntil: number | null;
	now: number;
	pullRequest: PullRequestStatusDto | null;
	reviewFeedback: ReviewFeedbackDto | null;
}>;

export type MergeQueueMove =
	| Readonly<{ kind: 'idle'; problem: string | null }>
	| Readonly<{ kind: 'wait'; step: ShipStep }>
	| Readonly<{ kind: 'backoff' }>
	| Readonly<{ kind: 'read-pull-request' }>
	| Readonly<{ kind: 'push' }>
	| Readonly<{ kind: 'open-draft' }>
	| Readonly<{ kind: 'mark-ready' }>
	| Readonly<{ kind: 'update-branch' }>
	| Readonly<{ kind: 'run-job'; builtin: JobBuiltin; signature: string; attempt: number }>
	| Readonly<{ kind: 'resolve-threads'; agentRunId: string }>
	| Readonly<{ kind: 'merge'; method: string; headSha: string }>
	| Readonly<{ kind: 'archive' }>
	| Readonly<{
			kind: 'needs-you';
			reason: ShipNeedsYouReason;
			detail: string;
			jobRunId: string | null;
	  }>;

export type ReviewRouting = Readonly<{
	botThreads: readonly ReviewThreadDto[];
	botChangeRequests: readonly RequestedChangeReviewDto[];
	humanThreads: readonly ReviewThreadDto[];
	humanChangeRequests: readonly RequestedChangeReviewDto[];
}>;

export const DEFAULT_SHIP_DELAYS = Object.freeze({
	idleDebounceMs: 5_000,
	agentPollMs: 60_000,
	checksPollMs: 45_000,
	reviewPollMs: 120_000,
	githubPollMs: 15_000,
	backoffBaseMs: 30_000,
	backoffCapMs: 600_000,
});

export type ShipDelays = Readonly<{ [Key in keyof typeof DEFAULT_SHIP_DELAYS]: number }>;

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
const JOB_STEPS: Readonly<Record<JobBuiltin, ShipStep>> = {
	'fix-checks': 'fixing-checks',
	'resolve-conflicts': 'resolving-conflicts',
	'address-review': 'addressing-review',
};
const JOB_LABELS: Readonly<Record<JobBuiltin, string>> = {
	'fix-checks': 'Fixing the checks',
	'resolve-conflicts': 'Resolving the conflicts',
	'address-review': 'Addressing the review',
};

export function nextMergeQueueMove(snapshot: MergeQueueSnapshot): MergeQueueMove {
	if (snapshot.phase === 'needs-you') return { kind: 'idle', problem: null };
	if (snapshot.backoffUntil !== null && snapshot.backoffUntil > snapshot.now) {
		return { kind: 'backoff' };
	}
	return snapshot.phase === 'draft' ? draftMove(snapshot) : queuedMove(snapshot);
}

export function jobIsActive(job: MergeQueueJob | null): boolean {
	return job !== null && ACTIVE_JOB_STATUSES.has(job.status);
}

export function jobStep(builtin: JobBuiltin | null): ShipStep {
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

export function reviewRouting(feedback: ReviewFeedbackDto | null): ReviewRouting {
	const threads = feedback?.unresolvedThreads ?? [];
	const changeRequests = feedback?.requestedChangeReviews ?? [];
	const botThread = (thread: ReviewThreadDto): boolean => thread.comments[0]?.authorIsBot === true;
	return {
		botThreads: threads.filter(botThread),
		botChangeRequests: changeRequests.filter((review) => review.authorIsBot),
		humanThreads: threads.filter((thread) => !botThread(thread)),
		humanChangeRequests: changeRequests.filter((review) => !review.authorIsBot),
	};
}

export function botReviewFeedback(feedback: ReviewFeedbackDto): ReviewFeedbackDto {
	const routing = reviewRouting(feedback);
	return {
		...feedback,
		unresolvedThreads: [...routing.botThreads],
		requestedChangeReviews: [...routing.botChangeRequests],
	};
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

function draftMove(snapshot: MergeQueueSnapshot): MergeQueueMove {
	if (!snapshot.pushRequested) return { kind: 'idle', problem: null };
	if (!snapshot.idle || jobIsActive(snapshot.job)) {
		return { kind: 'wait', step: 'waiting-for-agent' };
	}
	const operation = snapshot.worktree.operationInProgress;
	if (operation !== null) {
		return {
			kind: 'idle',
			problem: `A ${operation} is in progress in this workstream. Finish or abort it, then push again.`,
		};
	}
	if (snapshot.pullRequestNumber === null) return { kind: 'open-draft' };
	return hasUnpushedWork(snapshot.worktree) ? { kind: 'push' } : { kind: 'idle', problem: null };
}

function queuedMove(snapshot: MergeQueueSnapshot): MergeQueueMove {
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
		return fixJob(snapshot, 'resolve-conflicts', signature('conflicts', worktree.conflictedPaths));
	}
	if (snapshot.pullRequestNumber === null) return { kind: 'open-draft' };
	if (operation === 'merge' || hasUnpushedWork(worktree)) return { kind: 'push' };
	if (snapshot.threadResolutionRunId !== null) {
		return { kind: 'resolve-threads', agentRunId: snapshot.threadResolutionRunId };
	}
	const pullRequest = snapshot.pullRequest;
	if (pullRequest === null) return { kind: 'read-pull-request' };
	return pullRequestMove(snapshot, pullRequest);
}

function pullRequestMove(
	snapshot: MergeQueueSnapshot,
	pullRequest: PullRequestStatusDto,
): MergeQueueMove {
	if (pullRequest.state === 'merged') return { kind: 'archive' };
	if (pullRequest.state === 'closed') {
		return needsYou(
			snapshot,
			'pull-request-closed',
			`Pull request #${pullRequest.number ?? snapshot.pullRequestNumber} was closed without merging.`,
		);
	}
	if (pullRequest.state === 'not_open') return { kind: 'open-draft' };
	if (pullRequest.draft === true) return { kind: 'mark-ready' };
	const mergeState = mergeability(pullRequest);
	if (mergeState === 'conflicts' || mergeState === 'behind') return { kind: 'update-branch' };
	const failing = blockingFailedChecks(pullRequest);
	if (failing.length > 0) {
		return fixJob(
			snapshot,
			'fix-checks',
			signature(
				'checks',
				failing.map((check) => check.name),
			),
		);
	}
	if (checksPending(pullRequest)) return { kind: 'wait', step: 'waiting-for-checks' };
	const review = reviewRouting(snapshot.reviewFeedback);
	const botChangeRequests =
		pullRequest.reviewDecision === 'changes_requested' ? review.botChangeRequests : [];
	if (review.botThreads.length > 0 || botChangeRequests.length > 0) {
		return fixJob(
			snapshot,
			'address-review',
			signature('review', [
				...review.botThreads.map((thread) => thread.id),
				...botChangeRequests.map((request) => request.id),
			]),
		);
	}
	if (mergeState === 'blocked') return blockedMove(snapshot, pullRequest, review);
	if (pullRequest.viewerCanMerge === false) return notPermitted(snapshot);
	if (mergeState === 'unknown' || !pullRequest.headSha) {
		return { kind: 'wait', step: 'waiting-for-github' };
	}
	const method = mergeMethod(pullRequest);
	if (method === null) {
		return pullRequest.viewerCanMerge === null
			? { kind: 'wait', step: 'waiting-for-github' }
			: needsYou(
					snapshot,
					'merge-not-permitted',
					'This repository allows no merge method malini can use.',
				);
	}
	return { kind: 'merge', method, headSha: pullRequest.headSha };
}

function blockedMove(
	snapshot: MergeQueueSnapshot,
	pullRequest: PullRequestStatusDto,
	review: ReviewRouting,
): MergeQueueMove {
	if (pullRequest.reviewDecision === 'changes_requested') {
		return needsYou(snapshot, 'reply-to-reviewer', reviewerDetail(review));
	}
	if (pullRequest.reviewDecision === 'review_required') {
		return { kind: 'wait', step: 'waiting-for-review' };
	}
	if (review.humanThreads.length > 0) {
		return needsYou(snapshot, 'reply-to-reviewer', reviewerDetail(review));
	}
	if (pullRequest.viewerCanMerge === false) return notPermitted(snapshot);
	if (pullRequest.checksState === 'none') return { kind: 'wait', step: 'waiting-for-checks' };
	return needsYou(
		snapshot,
		'merge-not-permitted',
		'GitHub blocks this merge. Check the branch rules on GitHub.',
	);
}

function reviewerDetail(review: ReviewRouting): string {
	const logins = [
		...new Set(
			review.humanChangeRequests.flatMap((request) =>
				request.authorLogin ? [`@${request.authorLogin}`] : [],
			),
		),
	];
	if (logins.length > 0) return `${logins.join(', ')} requested changes.`;
	return 'A reviewer left comments that block the merge.';
}

function notPermitted(snapshot: MergeQueueSnapshot): MergeQueueMove {
	return needsYou(
		snapshot,
		'merge-not-permitted',
		'You do not have permission to merge this pull request.',
	);
}

function fixJob(
	snapshot: MergeQueueSnapshot,
	builtin: JobBuiltin,
	failure: string,
): MergeQueueMove {
	const repeated = snapshot.failureSignature === failure;
	if (repeated && snapshot.attempts >= snapshot.fixAttemptLimit) {
		const tries = snapshot.attempts === 1 ? 'once' : `${snapshot.attempts} times`;
		return needsYou(
			snapshot,
			'fix-gave-up',
			`${JOB_LABELS[builtin]} did not work. malini tried ${tries}.`,
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
	snapshot: MergeQueueSnapshot,
	reason: ShipNeedsYouReason,
	detail: string,
): MergeQueueMove {
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

function conflictsResolved(snapshot: MergeQueueSnapshot): boolean {
	return (
		snapshot.settledJob === 'resolve-conflicts' &&
		snapshot.worktree.conflictMarkerPaths.length === 0
	);
}

function hasUnpushedWork(worktree: MergeQueueWorktree): boolean {
	return worktree.dirtyPaths.length > 0 || worktree.ahead > 0 || !worktree.hasUpstream;
}

type Mergeability = 'ready' | 'conflicts' | 'behind' | 'blocked' | 'unknown';

function mergeability(pullRequest: PullRequestStatusDto): Mergeability {
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
