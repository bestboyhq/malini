import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { sessionRetryingQuery };

class SessionRetryingQuery {
	public readonly data: boolean = $derived(chatSessionStore.retryingSession);
}

const sessionRetryingQuery = new SessionRetryingQuery();
