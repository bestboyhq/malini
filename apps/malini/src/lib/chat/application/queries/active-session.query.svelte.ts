import type { SessionId } from '$lib/chat/domain/session';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { activeSessionQuery };

class ActiveSessionQuery {
	public readonly data: SessionId | null = $derived(chatSessionStore.sessionId);
}

const activeSessionQuery = new ActiveSessionQuery();
