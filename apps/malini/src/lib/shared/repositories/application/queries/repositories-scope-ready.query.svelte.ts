import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { repositoriesScopeReadyQuery };

class RepositoriesScopeReadyQuery {
	public readonly data: boolean = $derived(
		workstreamsAggregate.loaded &&
			repositoriesAggregate.loaded &&
			!workstreamsAggregate.lastError &&
			!repositoriesAggregate.lastError,
	);
}

const repositoriesScopeReadyQuery = new RepositoriesScopeReadyQuery();
