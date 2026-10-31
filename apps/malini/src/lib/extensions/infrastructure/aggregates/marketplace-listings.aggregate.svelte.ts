import type { ExtensionListing } from '$contract/marketplace';
import type { MarketplaceLoad } from '$lib/extensions/domain/extension-action';

class MarketplaceListingsAggregate {
	listings = $state.raw<readonly ExtensionListing[]>([]);
	load = $state.raw<MarketplaceLoad>({ state: 'loading' });

	replace(listings: readonly ExtensionListing[], unreachable: string | null): void {
		this.listings = listings;
		this.load = { state: 'ready', unreachable };
	}

	fail(error: string): void {
		this.load = { state: 'failed', error };
	}
}

export const marketplaceListingsAggregate = new MarketplaceListingsAggregate();
