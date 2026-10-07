import { agentRecovery } from '$lib/chat/infrastructure/services/agent-recovery.service';

export { startFreshChatCommand };

function startFreshChatCommand(): void {
	void agentRecovery.startFreshChat();
}
