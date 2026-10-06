import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { sessionBootErrorQuery };

class SessionBootErrorQuery {
	public readonly data: string | null = $derived(chatSessionStore.bootError);
}

const sessionBootErrorQuery = new SessionBootErrorQuery();
