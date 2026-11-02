import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';

export { loadModelProvidersCommand };

function loadModelProvidersCommand(): void {
	void modelProvidersStore.loadOnce();
}
