import { modelProvidersService } from '$shared/providers/infrastructure/services/model-providers.service';
import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';

export { signOutOfChatGptCommand };

async function signOutOfChatGptCommand(): Promise<void> {
	try {
		await modelProvidersService.signOutOfChatGpt();
	} finally {
		await modelProvidersStore.refresh();
	}
}
