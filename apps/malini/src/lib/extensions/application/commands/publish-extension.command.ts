import type { PublishableExtension } from '$contract/marketplace';
import { marketplaceListingsAggregate } from '$lib/extensions/infrastructure/aggregates/marketplace-listings.aggregate.svelte';
import { publishingAggregate } from '$lib/extensions/infrastructure/aggregates/publishing.aggregate.svelte';
import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';
import { extensionActionsStore } from '$lib/extensions/infrastructure/stores/extension-actions.store.svelte';

export { publishExtensionCommand };

function publishExtensionCommand(extension: PublishableExtension): void {
	const key = `publish:${extension.repositoryId}`;
	extensionActionsStore.set(key, { status: 'working', work: 'publishing' });
	void (async () => {
		try {
			const listing = await marketplaceService.publish(extension.repositoryId);
			const others = marketplaceListingsAggregate.listings.filter(
				(each) => each.publisher !== listing.publisher || each.name !== listing.name,
			);
			marketplaceListingsAggregate.replace([...others, listing], null);
			publishingAggregate.replace(await marketplaceService.publishing());
			extensionActionsStore.clear(key);
		} catch (error) {
			extensionActionsStore.set(key, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
