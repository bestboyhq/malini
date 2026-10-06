import {
	pullRequestBlockingChecks,
	pullRequestCheckFailed,
	pullRequestHasReviewBlockers,
	pullRequestReviewStatusUnavailable,
} from '@malini-extension/repository';
import type { ExtensionPullRequestContext } from '@malini/extension-api';
import type { PullRequestState } from '$lib/pull-requests/domain/pull-request-state';

export class PullRequestStateMapper {
	static fromRaw(pullRequest: ExtensionPullRequestContext | null | undefined): PullRequestState {
		return classifyPullRequestState(pullRequest);
	}
}

function classifyPullRequestState(
	pullRequest: ExtensionPullRequestContext | null | undefined,
): PullRequestState {
	if (!pullRequest) return 'unknown';

	switch (pullRequest.state) {
		case 'unavailable':
			return 'unknown';
		case 'merged':
			return 'merged';
		case 'closed':
			return 'closed';
		case 'not_open':
			return 'none';
		case 'draft':
			return 'draft';
		case 'open':
			return classifyOpenPullRequest(pullRequest);
		default:
			return 'unknown';
	}
}

function classifyOpenPullRequest(pullRequest: ExtensionPullRequestContext): PullRequestState {
	const checkItems = pullRequest.checkItems ?? [];
	const blockingChecks = pullRequestBlockingChecks(checkItems);

	if (blockingChecks.some(pullRequestCheckFailed)) return 'failing';

	if (checkItems.length === 0 && pullRequest.checks === 'failed') return 'failing';

	if (
		checksAreGreen(pullRequest) &&
		!pullRequestHasReviewBlockers(pullRequest) &&
		!pullRequestReviewStatusUnavailable(pullRequest) &&
		!mergeIsBlocked(pullRequest)
	) {
		return 'ready';
	}

	return 'open';
}

function checksAreGreen(pullRequest: ExtensionPullRequestContext): boolean {
	if (pullRequest.checks === 'unknown' || pullRequest.checks === 'none') return false;
	const checkItems = pullRequest.checkItems ?? [];
	if (checkItems.length > 0) return pullRequestBlockingChecks(checkItems).length === 0;
	return pullRequest.checks === 'success';
}

function mergeIsBlocked(pullRequest: ExtensionPullRequestContext): boolean {
	if (pullRequest.mergeable === false) return true;
	const mergeableState = pullRequest.mergeableState?.trim().toLocaleLowerCase() ?? '';
	return (
		mergeableState === 'blocked' ||
		mergeableState === 'dirty' ||
		mergeableState === 'behind' ||
		mergeableState === 'draft'
	);
}
