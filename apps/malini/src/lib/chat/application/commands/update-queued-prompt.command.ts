import type { AgentDraft } from '$lib/chat/domain/draft';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';

export { updateQueuedPromptCommand };

function updateQueuedPromptCommand(id: string, edit: AgentDraft): void {
	const { text, ...references } = edit;
	agentPromptQueue.update(chatRoute.workstreamId, id, { prompt: text, ...references });
}
