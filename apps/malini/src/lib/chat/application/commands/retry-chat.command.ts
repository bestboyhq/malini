import { agentRecovery } from '$lib/chat/infrastructure/services/agent-recovery.service';

export { retryChatCommand };

function retryChatCommand(): void {
	void agentRecovery.retryChat();
}
