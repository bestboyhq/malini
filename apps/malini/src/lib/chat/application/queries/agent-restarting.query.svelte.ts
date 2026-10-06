import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { agentRestartingQuery };

class AgentRestartingQuery {
	public readonly data: boolean = $derived(
		chatSessionStore.resettingRuns || chatSessionStore.retryingSession,
	);
}

const agentRestartingQuery = new AgentRestartingQuery();
