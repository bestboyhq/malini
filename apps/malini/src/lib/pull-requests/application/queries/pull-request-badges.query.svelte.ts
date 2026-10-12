import {
	pullRequestBadge,
	type PullRequestBadge,
	type PullRequestPhase,
} from '$lib/pull-requests/domain/pull-request-state';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';

export { pullRequestBadgesQuery };
export type { PullRequestBadge, PullRequestPhase };

class PullRequestBadgesQuery {
	public readonly data: (workstreamId: string) => PullRequestBadge = $derived(
		(workstreamId: string) =>
			pullRequestBadge(
				pullRequestShipAggregate.shipFor(workstreamId),
				pullRequestStateAggregate.stateFor(workstreamId),
			),
	);
}

const pullRequestBadgesQuery = new PullRequestBadgesQuery();
