import type { InstalledExtension } from '$contract/marketplace';
import type { ExtensionEntry } from '$lib/extensions/domain/extension-entry';
import { installedExtensionsAggregate } from '$lib/extensions/infrastructure/aggregates/installed-extensions.aggregate.svelte';
import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';
import { extensionActionsStore } from '$lib/extensions/infrastructure/stores/extension-actions.store.svelte';

export { installExtensionCommand };

function installExtensionCommand(entry: ExtensionEntry): void {
	extensionActionsStore.set(entry.key, {
		status: 'working',
		work: entry.installed ? 'updating' : 'installing',
	});
	void (async () => {
		try {
			const installed = await marketplaceService.install(entry.publisher, entry.name);
			installedExtensionsAggregate.replace(withInstalled(installed));
			extensionActionsStore.clear(entry.key);
		} catch (error) {
			extensionActionsStore.set(entry.key, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}

function withInstalled(installed: InstalledExtension): InstalledExtension[] {
	const others = (installedExtensionsAggregate.installed ?? []).filter(
		(each) => each.name !== installed.name,
	);
	return [...others, installed].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
