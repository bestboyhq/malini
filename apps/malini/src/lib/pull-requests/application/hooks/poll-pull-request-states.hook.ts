import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';

export function pollPullRequestStatesHook(): () => void {
	const stopPolling = pullRequestStateAggregate.startPolling();
	void pullRequestStateAggregate.refreshAll();
	return stopPolling;
}
