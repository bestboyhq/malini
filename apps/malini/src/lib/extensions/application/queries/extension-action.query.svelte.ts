import type { ExtensionAction } from '$lib/extensions/domain/extension-action';
import { extensionActionsStore } from '$lib/extensions/infrastructure/stores/extension-actions.store.svelte';

export { extensionActionQuery };

class ExtensionActionQuery {
	public readonly data: (key: string) => ExtensionAction | null = $derived(
		(key: string) => extensionActionsStore.actions.get(key) ?? null,
	);
}

const extensionActionQuery = new ExtensionActionQuery();
