import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { freshChatReturnQuery };

class FreshChatReturnQuery {
	public readonly data: string | undefined = $derived.by(() => {
		const workstreamId = chatRoute.workstreamId;
		if (chatSessionStore.emptySessionMode !== 'fresh' || !workstreamId) return undefined;
		const targetSessionId = sessionsAggregate.latestSessionFor(workstreamId);
		return targetSessionId ? chatRoute.hrefWithSession(targetSessionId) : undefined;
	});
}

const freshChatReturnQuery = new FreshChatReturnQuery();
