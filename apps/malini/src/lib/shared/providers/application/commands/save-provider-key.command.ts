import { modelProvidersService } from '$shared/providers/infrastructure/services/model-providers.service';
import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';

export { saveProviderKeyCommand };

async function saveProviderKeyCommand(providerId: string, apiKey: string): Promise<void> {
	await modelProvidersService.saveKey(providerId, apiKey);
	await modelProvidersStore.refresh();
}
