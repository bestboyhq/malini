import type { AnswerAgentQuestionInput } from '$lib/chat/domain/agent-interaction';
import { agentInteractionCommands } from '$lib/chat/infrastructure/aggregates/agent-interactions.aggregate.svelte';

export { answerQuestionCommand };

function answerQuestionCommand(input: AnswerAgentQuestionInput): void {
	void agentInteractionCommands.answerQuestion(input);
}
