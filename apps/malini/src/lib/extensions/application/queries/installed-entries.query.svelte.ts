import { installedEntries, type ExtensionEntry } from '$lib/extensions/domain/extension-entry';
import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';
import { marketplaceListingsAggregate } from '$lib/extensions/infrastructure/aggregates/marketplace-listings.aggregate.svelte';

export { installedEntriesQuery };

type InstalledListing = Readonly<{
	entries: readonly ExtensionEntry[] | null;
	failure: string | null;
}>;

class InstalledEntriesQuery {
	public readonly data: InstalledListing = $derived({
		entries: installedExtensionsAggregate.installed
			? installedEntries(
					installedExtensionsAggregate.installed,
					marketplaceListingsAggregate.listings,
				)
			: null,
		failure: installedExtensionsAggregate.failure,
	});
}

const installedEntriesQuery = new InstalledEntriesQuery();
