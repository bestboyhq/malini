import type { AgentQuestionRequest } from '$lib/chat/domain/agent-interaction';
import { agentInteractionCommands } from '$lib/chat/infrastructure/aggregates/agent-interactions.aggregate.svelte';

export { pendingQuestionQuery };

class PendingQuestionQuery {
	public readonly data: (sessionId: string | null) => AgentQuestionRequest | null = $derived(
		(sessionId: string | null) =>
			sessionId ? agentInteractionCommands.pendingQuestion(sessionId) : null,
	);
}

const pendingQuestionQuery = new PendingQuestionQuery();
