import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { agentEvents } from '$lib/chat/infrastructure/services/agent-events.service';

export { watchAgentChangeTriggersHook };

const CHANGE_TRIGGERS: ReadonlySet<string> = new Set([
	'file.changed',
	'run.completed',
	'command.completed',
]);

function watchAgentChangeTriggersHook(onTrigger: (workstreamId: string) => void): () => void {
	return agentEvents.subscribe((envelope) => {
		if (!envelope || !CHANGE_TRIGGERS.has(envelope.event.type)) return;
		const workstreamId = sessionsAggregate.getSession(envelope.sessionId)?.workstreamId;
		if (workstreamId) onTrigger(workstreamId);
	});
}
