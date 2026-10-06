import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { chatRunningQuery };

class ChatRunningQuery {
	public readonly data: boolean = $derived.by(() => {
		const sessionId = chatSessionStore.sessionId;
		if (!sessionId) return false;
		const status = sessionsAggregate.getSession(sessionId)?.status ?? 'idle';
		return (
			status === 'running' ||
			status === 'waiting_for_approval' ||
			chatSessionStore.isDispatchPending(sessionId)
		);
	});
}

const chatRunningQuery = new ChatRunningQuery();
