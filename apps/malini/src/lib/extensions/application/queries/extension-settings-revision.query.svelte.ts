import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

class ExtensionSettingsRevisionQuery {
	public readonly data: number = $derived(extensionRuntimeStore.settingsRevision);
}

export const extensionSettingsRevisionQuery = new ExtensionSettingsRevisionQuery();
