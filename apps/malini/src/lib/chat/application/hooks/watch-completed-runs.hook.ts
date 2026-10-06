import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { agentEvents } from '$lib/chat/infrastructure/services/agent-events.service';

export { watchCompletedRunsHook };

function watchCompletedRunsHook(
	onCompleted: (workstreamId: string, runId: string) => void,
): () => void {
	return agentEvents.subscribe((envelope) => {
		if (envelope?.event.type !== 'run.completed') return;
		const workstreamId = sessionsAggregate.getSession(envelope.sessionId)?.workstreamId;
		if (workstreamId) onCompleted(workstreamId, envelope.runId);
	});
}
