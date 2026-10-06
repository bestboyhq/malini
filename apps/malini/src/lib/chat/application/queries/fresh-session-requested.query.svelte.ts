import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { freshSessionRequestedQuery };

class FreshSessionRequestedQuery {
	public readonly data: boolean = $derived(
		chatSessionStore.emptySessionMode === 'fresh' ||
			(chatSessionStore.createFreshSessionOnNextPrompt && chatSessionStore.sessionId !== null),
	);
}

const freshSessionRequestedQuery = new FreshSessionRequestedQuery();
