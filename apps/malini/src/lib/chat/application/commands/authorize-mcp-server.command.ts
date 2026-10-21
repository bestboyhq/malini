import { toast } from '$hyper-ui/components/toast';
import { errorMessage } from '$lib/chat/domain/error-message';
import type { SessionId } from '$lib/chat/domain/session';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { mcpServerActionsStore } from '$lib/chat/infrastructure/stores/mcp-server-actions.store.svelte';
import { externalUrlService } from '$shared/system/external-url.service';

export { authorizeMcpServerCommand };

function authorizeMcpServerCommand(
	sessionId: SessionId,
	serverName: string,
	displayName: string,
): void {
	mcpServerActionsStore.start(sessionId, serverName);
	void (async () => {
		try {
			const { authUrl } = await agentSessions.authorizeMcpServer(sessionId, serverName);
			if (authUrl) await externalUrlService.open(authUrl);
		} catch (error) {
			toast.error(`Could not sign in to ${displayName} · ${errorMessage(error, 'unknown error')}`);
		} finally {
			mcpServerActionsStore.finish(sessionId, serverName);
		}
	})();
}
