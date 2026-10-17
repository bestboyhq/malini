import type { AgentQuestionRequest } from '$lib/chat/domain/agent-interaction';
import { agentInteractionCommands } from '$lib/chat/infrastructure/aggregates/agent-interactions.aggregate.svelte';

export { pendingQuestionsQuery };

const NONE: readonly AgentQuestionRequest[] = [];

class PendingQuestionsQuery {
	public readonly data: (sessionId: string | null) => readonly AgentQuestionRequest[] = $derived(
		(sessionId: string | null) =>
			sessionId ? agentInteractionCommands.pendingQuestions(sessionId) : NONE,
	);
}

const pendingQuestionsQuery = new PendingQuestionsQuery();
