import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';

export { refreshModelProvidersCommand };

function refreshModelProvidersCommand(): void {
	void modelProvidersStore.refreshModels();
}
