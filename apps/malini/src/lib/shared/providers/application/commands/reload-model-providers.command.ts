import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';

export { reloadModelProvidersCommand };

function reloadModelProvidersCommand(): void {
	void modelProvidersStore.refresh();
}
