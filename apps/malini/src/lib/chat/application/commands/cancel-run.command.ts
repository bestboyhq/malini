import { errorMessage } from '$lib/chat/domain/error-message';
import { isCancelRaceError } from '$lib/chat/domain/prompt-dispatch-failure';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

export { cancelRunCommand };

function cancelRunCommand(workstreamId: string): void {
	const sessionId = chatSessionStore.sessionId;
	if (!sessionId) return;
	void (async () => {
		try {
			await agentRunner.cancelRun(sessionId);
		} catch (error) {
			const message = errorMessage(error, 'cancelRun failed');
			if (isCancelRaceError(message)) {
				toast.warning('Run already finished · nothing to cancel', aboutWorkstream(workstreamId));
				return;
			}
			chatSessionStore.bootError = message;
		}
	})();
}
