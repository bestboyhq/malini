import type { InstalledExtension } from '$contract/marketplace';
import type { ExtensionEntry } from '$lib/extensions/domain/extension-entry';
import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';
import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';
import { extensionActionsStore } from '$lib/extensions/infrastructure/stores/extension-actions.store.svelte';

export { switchExtensionCommand };

function switchExtensionCommand(entry: ExtensionEntry, enabled: boolean): void {
	const before = installedExtensionsAggregate.installed ?? [];
	installedExtensionsAggregate.replace(
		before.map((each) => (each.name === entry.name ? { ...each, enabled } : each)),
	);
	extensionActionsStore.set(entry.key, { status: 'working', work: 'switching' });
	void (async () => {
		try {
			const switched = await marketplaceService.switch(entry.name, enabled);
			installedExtensionsAggregate.replace(replaced(switched));
			extensionActionsStore.clear(entry.key);
		} catch (error) {
			installedExtensionsAggregate.replace(before);
			extensionActionsStore.set(entry.key, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}

function replaced(switched: InstalledExtension): InstalledExtension[] {
	return (installedExtensionsAggregate.installed ?? []).map((each) =>
		each.name === switched.name ? switched : each,
	);
}
