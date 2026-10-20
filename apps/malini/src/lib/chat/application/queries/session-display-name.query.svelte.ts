import type { SessionId } from '$lib/chat/domain/session';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { sessionDisplayNameQuery };

class SessionDisplayNameQuery {
	public readonly data: (sessionId: SessionId) => string | null = $derived(
		(sessionId: SessionId) => sessionsAggregate.getSession(sessionId)?.displayName ?? null,
	);
}

const sessionDisplayNameQuery = new SessionDisplayNameQuery();
