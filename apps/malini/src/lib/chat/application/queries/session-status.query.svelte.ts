import type { SessionState } from '$lib/chat/domain/session-record';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { sessionStatusQuery };

class SessionStatusQuery {
	public readonly data: SessionState = $derived(
		chatSessionStore.sessionId
			? (sessionsAggregate.getSession(chatSessionStore.sessionId)?.status ?? 'idle')
			: 'idle',
	);
}

const sessionStatusQuery = new SessionStatusQuery();
