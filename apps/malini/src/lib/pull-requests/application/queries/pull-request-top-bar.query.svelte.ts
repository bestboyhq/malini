import {
	pullRequestAvailabilityOf,
	type PullRequestTopBar,
} from '$lib/pull-requests/domain/pull-request-action';
import { pullRequestTopBar } from '$lib/pull-requests/domain/pull-request-top-bar';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { pullRequestTopBarQuery };

class PullRequestTopBarQuery {
	public readonly data: (agentWorking: boolean) => PullRequestTopBar = $derived(
		(agentWorking: boolean) =>
			pullRequestTopBar(
				pullRequestShipAggregate.shipFor(pullRequestScopeStore.workstreamId),
				repositorySurfaceAggregate.presentedSurfaceFor(pullRequestScopeStore.workstreamId),
				pullRequestAvailabilityOf(pullRequestScopeStore),
				agentWorking,
			),
	);
}

const pullRequestTopBarQuery = new PullRequestTopBarQuery();
