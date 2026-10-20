import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

class ExtensionActivationGenerationQuery {
	public get data(): number {
		return extensionRuntimeStore.activationGeneration;
	}
}

export const extensionActivationGenerationQuery = new ExtensionActivationGenerationQuery();
