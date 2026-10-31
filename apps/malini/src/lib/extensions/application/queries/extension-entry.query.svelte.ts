import {
	discoverEntries,
	extensionKey,
	installedEntries,
	type ExtensionEntry,
} from '$lib/extensions/domain/extension-entry';
import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';
import { marketplaceListingsAggregate } from '$lib/extensions/infrastructure/aggregates/marketplace-listings.aggregate.svelte';

export { extensionEntryQuery };

class ExtensionEntryQuery {
	public readonly data: (publisher: string, name: string) => ExtensionEntry | null = $derived(
		(publisher: string, name: string) => {
			const key = extensionKey(publisher, name);
			const installed = installedExtensionsAggregate.installed ?? [];
			const listings = marketplaceListingsAggregate.listings;
			return (
				discoverEntries(listings, installed).find((entry) => entry.key === key) ??
				installedEntries(installed, listings).find((entry) => entry.key === key) ??
				null
			);
		},
	);
}

const extensionEntryQuery = new ExtensionEntryQuery();
