import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';

export function drivePromptQueueHook(): () => void {
	promptDelivery.open();
	return () => promptDelivery.close();
}
