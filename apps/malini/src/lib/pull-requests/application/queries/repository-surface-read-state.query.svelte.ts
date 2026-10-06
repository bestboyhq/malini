import {
	repositorySurfaceReadState,
	type RepositorySurfaceReadState,
} from '$lib/pull-requests/domain/repository-surface';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { repositorySurfaceReadStateQuery };

class RepositorySurfaceReadStateQuery {
	public readonly data: RepositorySurfaceReadState = $derived(
		repositorySurfaceReadState(
			repositorySurfaceAggregate.surfaceFor(pullRequestScopeStore.workstreamId),
			repositorySurfaceAggregate.loadFor(pullRequestScopeStore.workstreamId),
		),
	);
}

const repositorySurfaceReadStateQuery = new RepositorySurfaceReadStateQuery();
