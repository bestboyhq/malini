import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { repositoriesScopeErrorQuery };

class RepositoriesScopeErrorQuery {
	public readonly data: string | null = $derived(
		workstreamsAggregate.lastError ?? repositoriesAggregate.lastError ?? null,
	);
}

const repositoriesScopeErrorQuery = new RepositoriesScopeErrorQuery();
