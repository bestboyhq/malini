import { surfaceBlockingChecks } from './pull-request-top-bar';
import type { RepositorySurface, SurfacePullRequest } from './repository-surface';

export type PullRequestState =
	'none' | 'draft' | 'open' | 'ready' | 'failing' | 'merged' | 'closed' | 'unknown';

export type PullRequestTarget = Readonly<{
	workstreamId: string;
	repoId: string;
	head: string;
	base: string;
}>;

export const PULL_REQUEST_STATE_POLL_INTERVAL_MS = 5 * 60_000;

export const PULL_REQUEST_STATE_REUSE_MS = PULL_REQUEST_STATE_POLL_INTERVAL_MS / 2;

export function pullRequestStateOf(pullRequest: SurfacePullRequest | null): PullRequestState {
	switch (pullRequest?.state) {
		case 'merged':
			return 'merged';
		case 'closed':
			return 'closed';
		case 'not_open':
			return 'none';
		case 'draft':
			return 'draft';
		case 'open':
			return openPullRequestState(pullRequest);
		default:
			return 'unknown';
	}
}

export function observedPullRequestState(surface: RepositorySurface): PullRequestState | null {
	if (surface.pullRequestRefreshStatus !== 'ready') return null;
	const state = pullRequestStateOf(surface.pullRequest);
	return state === 'unknown' ? null : state;
}

function openPullRequestState(pullRequest: SurfacePullRequest): PullRequestState {
	const blockingChecks = surfaceBlockingChecks(pullRequest.checkItems);
	if (blockingChecks.some((check) => check.failed)) return 'failing';
	if (pullRequest.checkItems.length === 0 && pullRequest.checks === 'failed') return 'failing';
	if (
		checksAreGreen(pullRequest) &&
		!hasReviewBlockers(pullRequest) &&
		!pullRequest.reviewStatusUnavailable &&
		!mergeIsBlocked(pullRequest)
	) {
		return 'ready';
	}
	return 'open';
}

function checksAreGreen(pullRequest: SurfacePullRequest): boolean {
	if (pullRequest.checks === 'unknown' || pullRequest.checks === 'none') return false;
	if (pullRequest.checkItems.length > 0) {
		return surfaceBlockingChecks(pullRequest.checkItems).length === 0;
	}
	return pullRequest.checks === 'success';
}

function hasReviewBlockers(pullRequest: SurfacePullRequest): boolean {
	return (
		pullRequest.reviewDecision === 'changes_requested' ||
		pullRequest.reviewDecision === 'review_required' ||
		(pullRequest.unresolvedReviewThreadCount ?? 0) > 0
	);
}

function mergeIsBlocked(pullRequest: SurfacePullRequest): boolean {
	if (pullRequest.mergeable === false) return true;
	const mergeableState = pullRequest.mergeableState?.trim().toLocaleLowerCase() ?? '';
	return (
		mergeableState === 'blocked' ||
		mergeableState === 'dirty' ||
		mergeableState === 'behind' ||
		mergeableState === 'draft'
	);
}
