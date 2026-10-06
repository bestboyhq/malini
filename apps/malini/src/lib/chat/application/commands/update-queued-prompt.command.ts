import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';

export { updateQueuedPromptCommand };

function updateQueuedPromptCommand(id: string, prompt: string): void {
	agentPromptQueue.update(chatRoute.workstreamId, id, { prompt });
}
