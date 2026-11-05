import { modelProvidersStore } from '$shared/providers/infrastructure/stores/model-providers.store.svelte';

export { chatGptSignInQuery };

class ChatGptSignInQuery {
	public readonly waiting: boolean = $derived(modelProvidersStore.chatGptSignIn);
}

const chatGptSignInQuery = new ChatGptSignInQuery();
