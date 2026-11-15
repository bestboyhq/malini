import { acceptPullRequestReadCommand } from '$lib/pull-requests/application/commands/accept-pull-request-read.command';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { onPullRequestRead } from '$lib/pull-requests/infrastructure/services/pull-request-states.service';

export function pollPullRequestStatesHook(): () => void {
	const stopPolling = pullRequestStateAggregate.startPolling();
	const stopFollowing = onPullRequestRead(acceptPullRequestReadCommand);
	void pullRequestStateAggregate.refreshAll();
	return () => {
		stopFollowing();
		stopPolling();
	};
}
