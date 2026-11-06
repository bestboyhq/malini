import { modelProvidersService } from '$shared/providers/infrastructure/services/model-providers.service';
import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';

export { signInToChatGptCommand };

async function signInToChatGptCommand(): Promise<boolean> {
	modelProvidersStore.chatGptSignIn = true;
	try {
		const outcome = await modelProvidersService.signInToChatGpt();
		await modelProvidersStore.refresh();
		return outcome === 'signed-in';
	} finally {
		modelProvidersStore.chatGptSignIn = false;
	}
}
