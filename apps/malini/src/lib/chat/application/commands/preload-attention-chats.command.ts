import type { SessionId } from '$lib/chat/domain/session';
import { workstreamChatsPreloader } from '$lib/chat/infrastructure/services/workstream-chats-preloader.service';

export { preloadAttentionChatsCommand };

function preloadAttentionChatsCommand(sessionIds: readonly SessionId[]): void {
	workstreamChatsPreloader.preloadAttentionChats(sessionIds);
}
