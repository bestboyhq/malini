import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import type { QueuedPrompt } from '$lib/chat/domain/queued-prompt';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { composerSubmissionsStore } from '$lib/chat/infrastructure/stores/composer-submissions.store.svelte';
import { queueErrorsStore } from '$lib/chat/infrastructure/stores/queue-errors.store.svelte';

export { withdrawHeldPromptCommand };

function withdrawHeldPromptCommand(workstreamId: string, held: QueuedPrompt): void {
	const draftScope = agentDraftScopeKey(workstreamId, held.targetSessionId);
	queueErrorsStore.clear(held.id);
	agentPromptQueue.remove(workstreamId, held.id);
	agentDrafts.restore(draftScope, [held]);
	composerSubmissionsStore.markRestored(draftScope, 'withdrawn');
}
