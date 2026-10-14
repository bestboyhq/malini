import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';

export { hiddenRepositoriesQuery };

class HiddenRepositoriesQuery {
	public readonly data: ReadonlySet<string> = $derived(repositoriesAggregate.hiddenIds);
}

const hiddenRepositoriesQuery = new HiddenRepositoriesQuery();
