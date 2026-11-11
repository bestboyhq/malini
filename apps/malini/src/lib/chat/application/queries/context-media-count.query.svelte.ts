import { contextMediaAggregate } from '$lib/chat/infrastructure/aggregates/context-media.aggregate.svelte';

export { contextMediaCountQuery };

class ContextMediaCountQuery {
	public readonly data: (workstreamId: string) => number = $derived((workstreamId: string) => {
		const listing = contextMediaAggregate.listing;
		return listing?.workstreamId === workstreamId && listing.status === 'ready'
			? listing.media.length
			: 0;
	});
}

const contextMediaCountQuery = new ContextMediaCountQuery();
