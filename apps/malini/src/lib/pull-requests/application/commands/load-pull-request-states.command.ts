import type { PullRequestTarget } from '$lib/pull-requests/domain/pull-request-state';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';

export { loadPullRequestStatesCommand };

function loadPullRequestStatesCommand(targets: readonly PullRequestTarget[]): void {
	void pullRequestStateAggregate.track(targets);
}
