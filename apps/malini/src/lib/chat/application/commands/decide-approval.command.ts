import type { DecideAgentApprovalInput } from '$lib/chat/domain/agent-interaction';
import { agentInteractionCommands } from '$lib/chat/infrastructure/aggregates/agent-interactions.aggregate.svelte';

export { decideApprovalCommand };

function decideApprovalCommand(input: DecideAgentApprovalInput): void {
	void agentInteractionCommands.decideApproval(input);
}
