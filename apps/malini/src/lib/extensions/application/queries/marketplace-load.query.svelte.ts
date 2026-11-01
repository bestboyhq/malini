import type { MarketplaceLoad } from '$lib/extensions/domain/extension-action';
import { marketplaceListingsAggregate } from '$lib/extensions/infrastructure/aggregates/marketplace-listings.aggregate.svelte';

export { marketplaceLoadQuery };

class MarketplaceLoadQuery {
	public readonly data: MarketplaceLoad = $derived(marketplaceListingsAggregate.load);
}

const marketplaceLoadQuery = new MarketplaceLoadQuery();
