import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';

export { releasePromptQueueCommand };

function releasePromptQueueCommand(workstreamId: string): void {
	if (!workstreamId || agentPromptQueue.countFor(workstreamId) === 0) return;
	void (async () => {
		if (
			!sessionsAggregate.listSessions().some((session) => session.workstreamId === workstreamId)
		) {
			try {
				await sessionActivation.refreshSessionTabs(workstreamId);
			} catch {
				return;
			}
		}
		promptDelivery.release(workstreamId);
	})();
}
