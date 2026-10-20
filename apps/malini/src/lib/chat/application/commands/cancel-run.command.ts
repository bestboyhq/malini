import { errorMessage } from '$lib/chat/domain/error-message';
import { isCancelRaceError } from '$lib/chat/domain/prompt-dispatch-failure';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { cancelRunCommand };

function cancelRunCommand(): void {
	const sessionId = chatSessionStore.sessionId;
	if (!sessionId) return;
	void (async () => {
		try {
			await agentRunner.cancelRun(sessionId);
		} catch (error) {
			const message = errorMessage(error, 'cancelRun failed');
			if (!isCancelRaceError(message)) chatSessionStore.bootError = message;
		}
	})();
}
