import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';
import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';

export function followMarketplaceHook(): () => void {
	return marketplaceService.onChanged(() => void reloadInstalled());
}

async function reloadInstalled(): Promise<void> {
	try {
		installedExtensionsAggregate.replace(await marketplaceService.installed());
	} catch (error) {
		installedExtensionsAggregate.fail(error instanceof Error ? error.message : String(error));
	}
}
