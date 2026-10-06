import type { SessionId } from '$lib/chat/domain/session';
import { workstreamChatsPreloader } from '$lib/chat/infrastructure/services/workstream-chats-preloader.service';

export { warmWorkstreamChatCommand };

function warmWorkstreamChatCommand(workstreamId: string, sessionId: SessionId | null): void {
	if (!workstreamId) return;
	workstreamChatsPreloader.warm(workstreamId, sessionId);
}
