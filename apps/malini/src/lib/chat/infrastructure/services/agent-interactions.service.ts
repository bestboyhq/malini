import type {
	AnswerAgentQuestionInput,
	DecideAgentApprovalInput,
	DecideAgentApprovalResult,
} from '$lib/chat/domain/agent-interaction';
import { invoke } from '$shared/port/invoke';

class AgentInteractionsService {
	decideAgentApproval(input: DecideAgentApprovalInput): Promise<DecideAgentApprovalResult> {
		return invoke('chat.decide-approval', input);
	}

	answerAgentQuestion(input: AnswerAgentQuestionInput): Promise<void> {
		return invoke('chat.answer-question', input);
	}
}

export const agentInteractions = new AgentInteractionsService();
