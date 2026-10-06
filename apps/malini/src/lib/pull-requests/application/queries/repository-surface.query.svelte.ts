import type { RepositorySurface } from '$lib/pull-requests/domain/repository-surface';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { repositorySurfaceQuery };

class RepositorySurfaceQuery {
	public readonly data: RepositorySurface | null = $derived(
		repositorySurfaceAggregate.presentedSurfaceFor(pullRequestScopeStore.workstreamId),
	);
}

const repositorySurfaceQuery = new RepositorySurfaceQuery();
