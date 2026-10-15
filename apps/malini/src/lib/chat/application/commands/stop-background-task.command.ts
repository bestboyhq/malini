import { toast } from '$hyper-ui/components/toast';
import { errorMessage } from '$lib/chat/domain/error-message';
import type { SessionId } from '$lib/chat/domain/session';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';

export { stopBackgroundTaskCommand };

function stopBackgroundTaskCommand(sessionId: SessionId, taskId: string): void {
	void (async () => {
		try {
			await agentSessions.stopBackgroundTask(sessionId, taskId);
		} catch (error) {
			toast.error(`Could not stop the background task · ${errorMessage(error, 'unknown error')}`);
		}
	})();
}
