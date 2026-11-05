import { toast } from '$hyper-ui/components/toast';
import { modelProvidersService } from '$shared/providers/infrastructure/services/model-providers.service';
import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';

export { cancelChatGptSignInCommand };

function cancelChatGptSignInCommand(): void {
	modelProvidersStore.chatGptSignIn = false;
	modelProvidersService.cancelChatGptSignIn().catch((error: unknown) => {
		toast.error(error instanceof Error ? error.message : String(error));
	});
}
