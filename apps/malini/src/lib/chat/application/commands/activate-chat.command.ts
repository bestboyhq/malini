import { errorMessage } from '$lib/chat/domain/error-message';
import type { SessionId } from '$lib/chat/domain/session';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { activateChatCommand };

function activateChatCommand(sessionId: SessionId, workstreamId: string): void {
	void sessionActivation.activateFromRoute(sessionId, workstreamId).catch((error: unknown) => {
		if (chatRoute.workstreamId !== workstreamId) return;
		chatSessionStore.bootError = errorMessage(error, 'Failed to open agent session');
	});
}
