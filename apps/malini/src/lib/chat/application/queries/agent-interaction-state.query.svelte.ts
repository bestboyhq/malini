import type {
	AgentInteractionReference,
	AgentInteractionState,
} from '$lib/chat/domain/agent-interaction-state';
import { agentInteractionCommands } from '$lib/chat/infrastructure/aggregates/agent-interactions.aggregate.svelte';

export { agentInteractionStateQuery };

class AgentInteractionStateQuery {
	public readonly data: (reference: AgentInteractionReference) => AgentInteractionState = $derived(
		(reference: AgentInteractionReference) => agentInteractionCommands.stateFor(reference),
	);
}

const agentInteractionStateQuery = new AgentInteractionStateQuery();
