import type { SessionId } from '$lib/chat/domain/session';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { namedChatsQuery };

class NamedChatsQuery {
	public readonly data: (sessionId: SessionId) => boolean = $derived((sessionId: SessionId) =>
		sessionsAggregate.wasNamed(sessionId),
	);
}

const namedChatsQuery = new NamedChatsQuery();
