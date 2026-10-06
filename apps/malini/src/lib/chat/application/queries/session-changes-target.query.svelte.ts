import type { SessionId } from '$lib/chat/domain/session';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { sessionChangesTargetQuery };

class SessionChangesTargetQuery {
	public readonly data: SessionId | null = $derived.by(() => {
		const requestedSessionId = chatRoute.requestedSessionId;
		const sessionId = chatSessionStore.sessionId;
		const fresh =
			sessionId === null &&
			chatSessionStore.bootError === null &&
			(chatSessionStore.emptySessionMode === 'fresh' || requestedSessionId === null);
		if (
			(sessionId !== null && transcriptAggregate.ownerOf(sessionId) !== chatRoute.workstreamId) ||
			fresh ||
			(requestedSessionId && requestedSessionId !== sessionId)
		) {
			return null;
		}
		return sessionId;
	});
}

const sessionChangesTargetQuery = new SessionChangesTargetQuery();
