import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { openWorkstreamChatCommand };

function openWorkstreamChatCommand(workstreamId: string): void {
	const cachedSessionId = transcriptAggregate.restoreCached(
		workstreamId,
		chatRoute.readSessionParam(),
	);
	agentPromptQueue.hydrate(workstreamId);
	chatSessionStore.sessionId =
		cachedSessionId && transcriptAggregate.isReady(cachedSessionId) ? cachedSessionId : null;
	chatSessionStore.emptySessionMode = 'setup';
	chatSessionStore.bootError = null;
	chatSessionStore.projectedFor = workstreamId;
}
