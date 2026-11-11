import type { ContextMediaListing } from '$lib/chat/domain/context-media';
import { contextMediaAggregate } from '$lib/chat/infrastructure/aggregates/context-media.aggregate.svelte';

export { contextMediaListingQuery };

class ContextMediaListingQuery {
	public readonly data: (workstreamId: string) => ContextMediaListing | null = $derived(
		(workstreamId: string) =>
			contextMediaAggregate.listing?.workstreamId === workstreamId
				? contextMediaAggregate.listing
				: null,
	);
}

const contextMediaListingQuery = new ContextMediaListingQuery();
