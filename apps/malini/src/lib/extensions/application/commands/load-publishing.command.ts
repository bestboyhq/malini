import { publishingAggregate } from '$lib/extensions/infrastructure/aggregates/publishing.aggregate.svelte';
import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';

export { loadPublishingCommand };

function loadPublishingCommand(): void {
	void (async () => {
		try {
			publishingAggregate.replace(await marketplaceService.publishing());
		} catch (error) {
			publishingAggregate.fail(error instanceof Error ? error.message : String(error));
		}
	})();
}
