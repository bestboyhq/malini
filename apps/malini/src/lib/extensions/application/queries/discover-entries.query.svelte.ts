import {
	discoverEntries,
	entryMatches,
	type ExtensionEntry,
} from '$lib/extensions/domain/extension-entry';
import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';
import { marketplaceListingsAggregate } from '$lib/extensions/infrastructure/aggregates/marketplace-listings.aggregate.svelte';
import { marketplaceSearchStore } from '$lib/extensions/infrastructure/stores/marketplace-search.store.svelte';

export { discoverEntriesQuery };

class DiscoverEntriesQuery {
	public readonly data: readonly ExtensionEntry[] = $derived(
		discoverEntries(
			marketplaceListingsAggregate.listings,
			installedExtensionsAggregate.installed ?? [],
		).filter((entry) => entryMatches(entry, marketplaceSearchStore.query)),
	);
}

const discoverEntriesQuery = new DiscoverEntriesQuery();
