import { drainPromptQueueCommand } from '$lib/chat/application/commands/drain-prompt-queue.command';
import { errorMessage } from '$lib/chat/domain/error-message';
import { isCancelRaceError } from '$lib/chat/domain/prompt-dispatch-failure';
import type { SessionRecord } from '$lib/chat/domain/session-record';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

export { preemptWaitingChatCommand };

function preemptWaitingChatCommand(workstreamId: string, waiting: SessionRecord): void {
	void (async () => {
		try {
			await agentRunner.cancelRun(waiting.id);
		} catch (error) {
			const message = errorMessage(error, 'Failed to stop the chat waiting for your answer');
			if (!isCancelRaceError(message)) {
				if (chatRoute.workstreamId === workstreamId) {
					toast.error(message, aboutWorkstream(workstreamId));
				}
				return;
			}
		}
		if (chatRoute.workstreamId === workstreamId) {
			toast.info(
				`Interrupted ${waiting.displayName} · it was waiting for your answer`,
				aboutWorkstream(workstreamId),
			);
		}
		drainPromptQueueCommand(workstreamId);
	})();
}
