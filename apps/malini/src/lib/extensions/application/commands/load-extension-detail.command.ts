import { extensionKey } from '$lib/extensions/domain/extension-entry';
import { extensionDetailsAggregate } from '$lib/extensions/infrastructure/aggregates/extension-details.aggregate.svelte';
import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';

export { loadExtensionDetailCommand };

function loadExtensionDetailCommand(publisher: string, name: string): void {
	const key = extensionKey(publisher, name);
	if (extensionDetailsAggregate.details.get(key)?.state !== 'ready') {
		extensionDetailsAggregate.set(key, { state: 'loading' });
	}
	void (async () => {
		try {
			const detail = await marketplaceService.detail(publisher, name);
			extensionDetailsAggregate.set(key, { state: 'ready', detail });
		} catch (error) {
			extensionDetailsAggregate.set(key, {
				state: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
