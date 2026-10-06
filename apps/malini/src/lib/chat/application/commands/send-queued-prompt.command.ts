import { errorMessage } from '$lib/chat/domain/error-message';
import { classifyPromptDispatchFailure } from '$lib/chat/domain/prompt-dispatch-failure';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { queueErrorsStore } from '$lib/chat/infrastructure/stores/queue-errors.store.svelte';
import { queueSendingStore } from '$lib/chat/infrastructure/stores/queue-sending.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

export { sendQueuedPromptCommand };

function sendQueuedPromptCommand(id: string): void {
	void sendQueuedPrompt(id);
}

async function sendQueuedPrompt(id: string): Promise<void> {
	const workstreamId = chatRoute.workstreamId;
	if (!workstreamId || queueSendingStore.idFor(workstreamId) !== null) return;
	if (!agentPromptQueue.promote(workstreamId, id)) return;
	const entry = agentPromptQueue.entriesFor(workstreamId).find((queued) => queued.id === id);
	if (!entry) return;
	queueSendingStore.set(workstreamId, id);
	queueErrorsStore.clear(id);
	const holder = chatOccupancy.runBlocker(workstreamId, null);
	if (!holder) {
		const outcome = await promptDelivery.drain(workstreamId);
		if (outcome !== 'busy-retry') queueSendingStore.release(workstreamId, id);
		return;
	}
	toast.info(
		'Interrupting the current response · your queued prompt is next',
		aboutWorkstream(workstreamId),
	);
	try {
		await agentRunner.cancelRun(holder.id);
	} catch (error) {
		const message = errorMessage(error, 'Failed to send queued prompt');
		const failure = classifyPromptDispatchFailure({ stage: 'cancel', message });
		if (failure !== 'already-running' && failure !== 'cancel-race') {
			queueSendingStore.release(workstreamId, id);
			queueErrorsStore.set(id, message);
			if (chatRoute.workstreamId === workstreamId) {
				toast.error(message, aboutWorkstream(workstreamId));
			}
			return;
		}
	}
	if (chatRoute.workstreamId !== workstreamId) {
		queueSendingStore.release(workstreamId, id);
		return;
	}
	promptDelivery.armInterruptRecovery(workstreamId, holder.id, id);
}
