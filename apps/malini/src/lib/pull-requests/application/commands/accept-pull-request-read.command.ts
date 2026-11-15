import type { PullRequestState } from '$lib/pull-requests/domain/pull-request-state';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { refreshActivePullRequestCommand } from '$shared/repositories/repositories.api';

export { acceptPullRequestReadCommand };

function acceptPullRequestReadCommand(workstreamId: string, state: PullRequestState): void {
	pullRequestStateAggregate.observe(workstreamId, state);
	refreshActivePullRequestCommand(workstreamId);
}
