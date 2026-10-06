import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';

export { drainPromptQueueCommand };

function drainPromptQueueCommand(workstreamId: string): void {
	promptDelivery.scheduleDrain(workstreamId);
}
