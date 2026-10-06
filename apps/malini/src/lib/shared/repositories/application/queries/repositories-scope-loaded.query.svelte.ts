import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { repositoriesScopeLoadedQuery };

class RepositoriesScopeLoadedQuery {
	public readonly data: boolean = $derived(
		workstreamsAggregate.loaded && repositoriesAggregate.loaded,
	);
}

const repositoriesScopeLoadedQuery = new RepositoriesScopeLoadedQuery();
