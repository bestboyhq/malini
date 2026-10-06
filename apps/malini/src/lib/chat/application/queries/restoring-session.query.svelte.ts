import type { SessionId } from '$lib/chat/domain/session';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { restoringSessionQuery };

class RestoringSessionQuery {
	public readonly data: SessionId | null = $derived.by(() => {
		const workstreamId = chatRoute.workstreamId;
		if (
			chatRoute.requestedSessionId !== null ||
			chatSessionStore.sessionId !== null ||
			chatSessionStore.bootError !== null ||
			chatSessionStore.emptySessionMode === 'fresh' ||
			!chatSessionStore.isPreparing(workstreamId)
		) {
			return null;
		}
		return sessionsAggregate.latestSessionFor(workstreamId);
	});
}

const restoringSessionQuery = new RestoringSessionQuery();
