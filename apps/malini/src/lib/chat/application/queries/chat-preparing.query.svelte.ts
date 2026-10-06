import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { chatPreparingQuery };

class ChatPreparingQuery {
	public readonly data: boolean = $derived(chatSessionStore.isPreparing(chatRoute.workstreamId));
}

const chatPreparingQuery = new ChatPreparingQuery();
