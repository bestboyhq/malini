import type { AgentAccess } from '$shared/providers/domain/run-profile';
import { agentAccessDefaultStore } from '$shared/providers/infrastructure/stores/agent-access-default.store.svelte';

export { agentAccessDefaultQuery };

class AgentAccessDefaultQuery {
	public readonly data: AgentAccess = $derived(agentAccessDefaultStore.access);
}

const agentAccessDefaultQuery = new AgentAccessDefaultQuery();
