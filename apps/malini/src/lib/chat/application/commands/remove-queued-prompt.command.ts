import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { queueErrorsStore } from '$lib/chat/infrastructure/stores/queue-errors.store.svelte';

export { removeQueuedPromptCommand };

function removeQueuedPromptCommand(id: string): void {
	const workstreamId = chatRoute.workstreamId;
	if (promptDelivery.isRecoveringEntry(workstreamId, id)) {
		promptDelivery.disarmInterruptRecovery(workstreamId);
	}
	queueErrorsStore.clear(id);
	agentPromptQueue.remove(workstreamId, id);
}
