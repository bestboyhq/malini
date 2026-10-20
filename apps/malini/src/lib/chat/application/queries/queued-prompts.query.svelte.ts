import type { QueuedPrompt } from '$lib/chat/domain/queued-prompt';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { queuedPromptsQuery };

class QueuedPromptsQuery {
	public readonly data: readonly QueuedPrompt[] = $derived(
		agentPromptQueue.waitingEntriesForSession(chatRoute.workstreamId, chatSessionStore.sessionId),
	);
}

const queuedPromptsQuery = new QueuedPromptsQuery();
