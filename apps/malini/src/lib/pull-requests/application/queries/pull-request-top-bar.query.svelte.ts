import {
	pullRequestAvailabilityOf,
	type PullRequestTopBarPresentation,
} from '$lib/pull-requests/domain/pull-request-action';
import { pullRequestTopBarPresentation } from '$lib/pull-requests/domain/pull-request-top-bar';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { pullRequestTopBarQuery };

class PullRequestTopBarQuery {
	public readonly data: PullRequestTopBarPresentation | null = $derived(
		pullRequestTopBarPresentation(
			repositorySurfaceAggregate.presentedSurfaceFor(pullRequestScopeStore.workstreamId),
			pullRequestAvailabilityOf(pullRequestScopeStore),
		),
	);
}

const pullRequestTopBarQuery = new PullRequestTopBarQuery();
