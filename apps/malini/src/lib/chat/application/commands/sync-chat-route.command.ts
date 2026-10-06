import { errorMessage } from '$lib/chat/domain/error-message';
import type { SessionId } from '$lib/chat/domain/session';
import { chatRouteSync } from '$lib/chat/infrastructure/services/chat-route-sync.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export { syncChatRouteCommand };

function syncChatRouteCommand(sessionId: SessionId, workstreamId: string): void {
	void chatRouteSync.syncSessionUrl(sessionId, workstreamId).catch((error: unknown) => {
		if (
			chatRoute.workstreamId === workstreamId &&
			chatSessionStore.sessionId === sessionId &&
			!chatRoute.hasSessionParam()
		) {
			chatSessionStore.bootError = errorMessage(error, 'Failed to synchronize the active chat URL');
		}
	});
}
