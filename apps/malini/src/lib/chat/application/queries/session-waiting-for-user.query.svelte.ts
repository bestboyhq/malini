import type { SessionId } from '$lib/chat/domain/session';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { sessionWaitingForUserQuery };

class SessionWaitingForUserQuery {
	public readonly data: (sessionId: SessionId) => boolean = $derived(
		(sessionId: SessionId) =>
			sessionsAggregate.getSession(sessionId)?.status === 'waiting_for_approval',
	);
}

const sessionWaitingForUserQuery = new SessionWaitingForUserQuery();
