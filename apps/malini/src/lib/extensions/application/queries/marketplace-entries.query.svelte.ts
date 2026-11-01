import { discoverEntries, type ExtensionEntry } from '$lib/extensions/domain/extension-entry';
import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';
import { marketplaceListingsAggregate } from '$lib/extensions/infrastructure/aggregates/marketplace-listings.aggregate.svelte';

export { marketplaceEntriesQuery };

class MarketplaceEntriesQuery {
	public readonly data: readonly ExtensionEntry[] = $derived(
		discoverEntries(
			marketplaceListingsAggregate.listings,
			installedExtensionsAggregate.installed ?? [],
		).filter((entry) => entry.installed === null),
	);
}

const marketplaceEntriesQuery = new MarketplaceEntriesQuery();
