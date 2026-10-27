import { toast } from '$hyper-ui/components/toast';
import { errorMessage } from '$lib/chat/domain/error-message';
import type { SessionId } from '$lib/chat/domain/session';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { continueRunCommand };

function continueRunCommand(sessionId: SessionId): void {
	if (chatSessionStore.continuingRun) return;
	chatSessionStore.continuingRun = true;
	void (async () => {
		try {
			await agentSessions.continueRun(sessionId);
		} catch (error) {
			toast.error(`The turn could not go on · ${errorMessage(error, 'unknown error')}`);
		} finally {
			chatSessionStore.continuingRun = false;
		}
	})();
}
