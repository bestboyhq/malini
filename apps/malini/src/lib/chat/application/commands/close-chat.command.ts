import { forgetChatCommand } from '$lib/chat/application/commands/forget-chat.command';
import { errorMessage } from '$lib/chat/domain/error-message';
import type { SessionId } from '$lib/chat/domain/session';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { closingChatsStore } from '$lib/chat/infrastructure/stores/closing-chats.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

export { closeChatCommand };

function closeChatCommand(workstreamId: string, sessionId: SessionId): void {
	closingChatsStore.add(sessionId);
	void (async () => {
		try {
			await agentSessions.archive(sessionId);
			closingChatsStore.remove(sessionId);
			forgetChatCommand(workstreamId, sessionId);
		} catch (cause) {
			closingChatsStore.remove(sessionId);
			toast.error(
				`Could not close agent chat · ${errorMessage(cause, 'Close failed')}`,
				aboutWorkstream(workstreamId),
			);
		}
	})();
}
