import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { closeFreshChatCommand };

function closeFreshChatCommand(): void {
	const workstreamId = chatRoute.workstreamId;
	const activeSessionId = chatSessionStore.sessionId;
	if (!workstreamId || (activeSessionId && chatOccupancy.sessionIsBusy(activeSessionId))) return;
	const targetSessionId = sessionsAggregate.latestSessionFor(workstreamId);
	if (!targetSessionId) return;

	chatSessionStore.createFreshSessionOnNextPrompt = false;
	chatSessionStore.emptySessionMode = 'setup';
	void sessionActivation.activate(targetSessionId, workstreamId);
}
