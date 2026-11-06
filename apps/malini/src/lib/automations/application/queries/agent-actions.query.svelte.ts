import type { AgentActionRecord } from '$contract/automations';
import { agentActionsAggregate } from '$lib/automations/infrastructure/aggregates/agent-actions.aggregate.svelte';

export { agentActionsQuery };

class AgentActionsQuery {
	public readonly data: readonly AgentActionRecord[] = $derived(agentActionsAggregate.actions);
}

const agentActionsQuery = new AgentActionsQuery();
