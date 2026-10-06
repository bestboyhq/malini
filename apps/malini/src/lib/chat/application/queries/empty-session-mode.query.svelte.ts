import type { EmptySessionMode } from '$lib/chat/domain/empty-session-mode';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { emptySessionModeQuery };

class EmptySessionModeQuery {
	public readonly data: EmptySessionMode = $derived(chatSessionStore.emptySessionMode);
}

const emptySessionModeQuery = new EmptySessionModeQuery();
