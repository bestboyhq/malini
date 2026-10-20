import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';

export { requestedSessionQuery };

class RequestedSessionQuery {
	public readonly data: string | null = $derived(chatRoute.requestedSessionId);
}

const requestedSessionQuery = new RequestedSessionQuery();
