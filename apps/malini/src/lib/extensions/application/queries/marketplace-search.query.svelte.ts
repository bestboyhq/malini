import { marketplaceSearchStore } from '$lib/extensions/infrastructure/stores/marketplace-search.store.svelte';

export { marketplaceSearchQuery };

class MarketplaceSearchQuery {
	public readonly data: string = $derived(marketplaceSearchStore.query);
}

const marketplaceSearchQuery = new MarketplaceSearchQuery();
