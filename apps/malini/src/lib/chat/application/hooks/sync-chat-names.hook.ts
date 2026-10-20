import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';

export { syncChatNamesHook };

function syncChatNamesHook(): () => void {
	return agentSessions.onRenamed((sessionId, name) =>
		sessionsAggregate.setSessionDisplayName(sessionId, name),
	);
}
