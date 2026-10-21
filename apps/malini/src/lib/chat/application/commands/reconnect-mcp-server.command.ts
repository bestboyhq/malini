import { toast } from '$hyper-ui/components/toast';
import { errorMessage } from '$lib/chat/domain/error-message';
import type { SessionId } from '$lib/chat/domain/session';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { mcpServerActionsStore } from '$lib/chat/infrastructure/stores/mcp-server-actions.store.svelte';

export { reconnectMcpServerCommand };

function reconnectMcpServerCommand(
	sessionId: SessionId,
	serverName: string,
	displayName: string,
): void {
	mcpServerActionsStore.start(sessionId, serverName);
	void (async () => {
		try {
			await agentSessions.reconnectMcpServer(sessionId, serverName);
		} catch (error) {
			toast.error(`Could not reconnect ${displayName} · ${errorMessage(error, 'unknown error')}`);
		} finally {
			mcpServerActionsStore.finish(sessionId, serverName);
		}
	})();
}
