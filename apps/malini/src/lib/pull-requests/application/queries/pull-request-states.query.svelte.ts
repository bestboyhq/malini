import type { PullRequestState } from '$lib/pull-requests/domain/pull-request-state';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';

export { pullRequestStatesQuery };
export type { PullRequestState };

class PullRequestStatesQuery {
	public readonly data: Readonly<Record<string, PullRequestState>> = $derived(
		pullRequestStateAggregate.stateByWorkstream,
	);
}

const pullRequestStatesQuery = new PullRequestStatesQuery();
