import type { PublicRepository } from '$contract/stats';
import { publicRepositoriesAggregate } from '$lib/stats/infrastructure/aggregates/public-repositories.aggregate.svelte';

export { publicRepositoriesQuery };

class PublicRepositoriesQuery {
	public readonly data: readonly PublicRepository[] | null = $derived(
		publicRepositoriesAggregate.repositories,
	);
}

const publicRepositoriesQuery = new PublicRepositoriesQuery();
