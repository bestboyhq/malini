import type { ExtensionEntry } from '$lib/extensions/domain/extension-entry';
import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';
import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';
import { extensionActionsStore } from '$lib/extensions/infrastructure/stores/extension-actions.store.svelte';

export { uninstallExtensionCommand };

function uninstallExtensionCommand(entry: ExtensionEntry): void {
	extensionActionsStore.set(entry.key, { status: 'working', work: 'uninstalling' });
	void (async () => {
		try {
			await marketplaceService.uninstall(entry.name);
			installedExtensionsAggregate.replace(
				(installedExtensionsAggregate.installed ?? []).filter((each) => each.name !== entry.name),
			);
			extensionActionsStore.clear(entry.key);
		} catch (error) {
			extensionActionsStore.set(entry.key, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
