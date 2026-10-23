import { toast } from '$hyper-ui/components/toast';
import type { McpServerTarget } from '$contract/mcp-servers';
import { errorMessage } from '$lib/chat/domain/error-message';
import { mcpServersService } from '$lib/chat/infrastructure/services/mcp-servers.service';
import { mcpServerActionsStore } from '$lib/chat/infrastructure/stores/mcp-server-actions.store.svelte';
import { externalUrlService } from '$shared/system/external-url.service';

export { authorizeMcpServerCommand };

function authorizeMcpServerCommand(
	target: McpServerTarget,
	serverName: string,
	displayName: string,
): void {
	mcpServerActionsStore.start(target, serverName);
	void (async () => {
		try {
			const authUrl = await mcpServersService.authorize(target, serverName);
			if (authUrl) await externalUrlService.open(authUrl);
		} catch (error) {
			toast.error(`Could not sign in to ${displayName} · ${errorMessage(error, 'unknown error')}`);
		} finally {
			mcpServerActionsStore.finish(target, serverName);
		}
	})();
}
