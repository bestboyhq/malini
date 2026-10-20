import type { AgentAccess } from '$shared/providers/domain/run-profile';
import { agentAccessDefaultStorage } from '$shared/providers/infrastructure/services/agent-access-default.storage';
import { agentAccessDefaultStore } from '$shared/providers/infrastructure/stores/agent-access-default.store.svelte';

export { saveAgentAccessDefaultCommand };

function saveAgentAccessDefaultCommand(access: AgentAccess): void {
	agentAccessDefaultStorage.write(access);
	agentAccessDefaultStore.set(access);
}
