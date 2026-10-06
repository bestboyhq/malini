import { freshChatReturnSessionId } from '$lib/chat/domain/fresh-chat-return';
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
	const returnSessionId = chatSessionStore.freshReturnSessionId;
	const targetSessionId = freshChatReturnSessionId({
		workstreamId,
		sessions: sessionsAggregate.listSessions(),
		returnSession: returnSessionId ? sessionsAggregate.getSession(returnSessionId) : null,
	});
	if (!targetSessionId) return;

	chatSessionStore.freshReturnSessionId = null;
	chatSessionStore.createFreshSessionOnNextPrompt = false;
	chatSessionStore.emptySessionMode = 'setup';
	void sessionActivation.activate(targetSessionId, workstreamId);
}
