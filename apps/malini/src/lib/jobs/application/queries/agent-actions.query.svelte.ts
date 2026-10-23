import type { AgentActionRecord } from '$contract/jobs';
import { agentActionsAggregate } from '$lib/jobs/infrastructure/aggregates/agent-actions.aggregate.svelte';

export { agentActionsQuery };

class AgentActionsQuery {
	public readonly data: readonly AgentActionRecord[] = $derived(agentActionsAggregate.actions);
}

const agentActionsQuery = new AgentActionsQuery();
