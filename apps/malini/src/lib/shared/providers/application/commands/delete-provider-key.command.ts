import { modelProvidersService } from '$shared/providers/infrastructure/services/model-providers.service';
import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';

export { deleteProviderKeyCommand };

async function deleteProviderKeyCommand(providerId: string): Promise<void> {
	await modelProvidersService.deleteKey(providerId);
	await modelProvidersStore.refresh();
}
