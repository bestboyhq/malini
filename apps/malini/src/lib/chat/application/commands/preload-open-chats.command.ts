import type { SessionId } from '$lib/chat/domain/session';
import { workstreamChatsPreloader } from '$lib/chat/infrastructure/services/workstream-chats-preloader.service';

export { preloadOpenChatsCommand };

function preloadOpenChatsCommand(
	currentSessionId: SessionId | null,
	sessionIds: readonly SessionId[],
): void {
	workstreamChatsPreloader.preloadOpenChats(currentSessionId, sessionIds);
}
