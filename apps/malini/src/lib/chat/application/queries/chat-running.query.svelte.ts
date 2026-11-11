import { isAgentWorking } from '$contract/agent-state-machine';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { pendingPromptStore } from '$lib/chat/infrastructure/stores/pending-prompt.store.svelte';

export { chatRunningQuery };

class ChatRunningQuery {
	public readonly data: boolean = $derived.by(() => {
		const sessionId = chatSessionStore.sessionId;
		if (!sessionId) return false;
		return (
			isAgentWorking(sessionsAggregate.getSession(sessionId)?.status) ||
			chatSessionStore.isDispatchPending(sessionId) ||
			pendingPromptStore.for(sessionId) !== null
		);
	});
}

const chatRunningQuery = new ChatRunningQuery();
