class MarketplaceSearchStore {
	query: string = $state('');

	set(query: string): void {
		this.query = query;
	}
}

export const marketplaceSearchStore = new MarketplaceSearchStore();
