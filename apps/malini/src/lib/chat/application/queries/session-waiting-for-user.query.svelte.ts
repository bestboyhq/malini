import { isWaitingForUser } from '$contract/agent-state-machine';
import type { SessionId } from '$lib/chat/domain/session';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { sessionWaitingForUserQuery };

class SessionWaitingForUserQuery {
	public readonly data: (sessionId: SessionId) => boolean = $derived((sessionId: SessionId) =>
		isWaitingForUser(sessionsAggregate.getSession(sessionId)?.status),
	);
}

const sessionWaitingForUserQuery = new SessionWaitingForUserQuery();
