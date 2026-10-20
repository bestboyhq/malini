import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

class ExtensionRuntimeErrorQuery {
	public readonly data: string | null = $derived(extensionRuntimeStore.error);
}

export const extensionRuntimeErrorQuery = new ExtensionRuntimeErrorQuery();
