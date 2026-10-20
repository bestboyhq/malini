import { agentRecovery } from '$lib/chat/infrastructure/services/agent-recovery.service';

export { restartAgentCommand };

function restartAgentCommand(): void {
	void agentRecovery.restartAgentProcess();
}
