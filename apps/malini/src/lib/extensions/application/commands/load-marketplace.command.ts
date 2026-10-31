import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';
import { marketplaceListingsAggregate } from '$lib/extensions/infrastructure/aggregates/marketplace-listings.aggregate.svelte';
import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';

export { loadMarketplaceCommand };

function loadMarketplaceCommand(): void {
	void (async () => {
		try {
			installedExtensionsAggregate.replace(await marketplaceService.installed());
		} catch (error) {
			installedExtensionsAggregate.fail(described(error));
		}
	})();
	void (async () => {
		try {
			const { listings, unreachable } = await marketplaceService.listings();
			marketplaceListingsAggregate.replace(listings, unreachable);
		} catch (error) {
			marketplaceListingsAggregate.fail(described(error));
		}
	})();
}

function described(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
