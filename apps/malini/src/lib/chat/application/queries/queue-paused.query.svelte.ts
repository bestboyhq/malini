import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';

export { queuePausedQuery };

class QueuePausedQuery {
	public readonly data: boolean = $derived(agentPromptQueue.isPaused(chatRoute.workstreamId));
}

const queuePausedQuery = new QueuePausedQuery();
