import type { AgentQuestionRequest } from '$lib/chat/domain/agent-interaction';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import { agentInteractionCommands } from '$lib/chat/infrastructure/aggregates/agent-interactions.aggregate.svelte';
import { childRequestsAggregate } from '$lib/chat/infrastructure/aggregates/child-requests.aggregate.svelte';

export { childRequestsQuery };

class ChildRequestsQuery {
	public readonly approvals: (sessionId: SessionId) => readonly EventEnvelope[] = $derived(
		(sessionId: SessionId) =>
			childRequestsAggregate.envelopesFor(sessionId).filter((envelope) => {
				if (envelope.event.type !== 'approval.requested') return false;
				const { status } = agentInteractionCommands.stateFor({
					kind: 'approval',
					sessionId: envelope.sessionId,
					runId: envelope.runId,
					requestId: envelope.event.approvalId,
				});
				return status !== 'resolved' && status !== 'stale';
			}),
	);

	public readonly questions: (sessionId: SessionId) => readonly AgentQuestionRequest[] = $derived(
		(sessionId: SessionId) => agentInteractionCommands.pendingQuestions(sessionId),
	);
}

const childRequestsQuery = new ChildRequestsQuery();
