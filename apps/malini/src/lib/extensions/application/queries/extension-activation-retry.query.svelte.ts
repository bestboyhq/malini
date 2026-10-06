import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

class ExtensionActivationRetryQuery {
	public readonly data: number = $derived(extensionRuntimeStore.activationRetryRevision);
}

export const extensionActivationRetryQuery = new ExtensionActivationRetryQuery();
