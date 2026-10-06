import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';
import type { WorkstreamSetupOutcome } from '$shared/repositories/repositories.api';

export { settleWorkstreamSetupQueueCommand };

function settleWorkstreamSetupQueueCommand(outcome: WorkstreamSetupOutcome): void {
	if (outcome.status === 'abandoned') {
		agentPromptQueue.clear(outcome.workstreamId);
		return;
	}
	promptDelivery.release(outcome.workstreamId);
}
