import type { AgentAccess } from '$shared/providers/domain/run-profile';
import { agentAccessDefaultStorage } from '$shared/providers/infrastructure/services/agent-access-default.storage';

class AgentAccessDefaultStore {
	access: AgentAccess = $state(agentAccessDefaultStorage.read());

	set(access: AgentAccess): void {
		this.access = access;
	}
}

export const agentAccessDefaultStore = new AgentAccessDefaultStore();
