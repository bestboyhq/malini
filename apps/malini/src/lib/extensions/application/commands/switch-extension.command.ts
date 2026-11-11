import type { InstalledExtension } from '$contract/marketplace';
import type { ExtensionEntry } from '$lib/extensions/domain/extension-entry';
import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';
import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';
import { extensionActionsStore } from '$lib/extensions/infrastructure/stores/extension-actions.store.svelte';

export { switchExtensionCommand };

function switchExtensionCommand(entry: ExtensionEntry, enabled: boolean): void {
	const was = entry.installed?.enabled ?? !enabled;
	patch(entry.name, (each) => ({ ...each, enabled }));
	extensionActionsStore.set(entry.key, { status: 'working', work: 'switching' });
	void (async () => {
		try {
			const switched = await marketplaceService.switch(entry.name, enabled);
			patch(switched.name, () => switched);
			extensionActionsStore.clear(entry.key);
		} catch (error) {
			patch(entry.name, (each) => ({ ...each, enabled: was }));
			extensionActionsStore.set(entry.key, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}

function patch(name: string, change: (installed: InstalledExtension) => InstalledExtension): void {
	installedExtensionsAggregate.replace(
		(installedExtensionsAggregate.installed ?? []).map((each) =>
			each.name === name ? change(each) : each,
		),
	);
}
