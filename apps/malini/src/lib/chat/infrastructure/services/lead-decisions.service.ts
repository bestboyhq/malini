import type { ChatDelivery } from '$contract/deliveries';
import type { AnswerLeadDecisionArgs, LeadDecision } from '$contract/leads';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class LeadDecisionsService {
	list(sessionId: string): Promise<LeadDecision[]> {
		return invoke('chat.list-lead-decisions', { sessionId });
	}

	answer(args: AnswerLeadDecisionArgs): Promise<LeadDecision> {
		return invoke('chat.answer-lead-decision', args);
	}

	listDeliveries(fromSessionId: string): Promise<ChatDelivery[]> {
		return invoke('chat.list-deliveries', { fromSessionId });
	}

	onDecisionChanged(listener: (decision: LeadDecision) => void): () => void {
		return onPlatformEvent('chat:lead-decision-changed', ({ decision }) => listener(decision));
	}

	onDeliveryChanged(listener: (delivery: ChatDelivery) => void): () => void {
		return onPlatformEvent('chat:delivery-changed', ({ delivery }) => listener(delivery));
	}
}

export const leadDecisionsService = new LeadDecisionsService();
