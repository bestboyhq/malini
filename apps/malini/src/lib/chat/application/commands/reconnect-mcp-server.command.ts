import { toast } from '$hyper-ui/components/toast';
import type { McpServerTarget } from '$contract/mcp-servers';
import { errorMessage } from '$lib/chat/domain/error-message';
import { mcpServersService } from '$lib/chat/infrastructure/services/mcp-servers.service';
import { mcpServerActionsStore } from '$lib/chat/infrastructure/stores/mcp-server-actions.store.svelte';

export { reconnectMcpServerCommand };

function reconnectMcpServerCommand(
	target: McpServerTarget,
	serverName: string,
	displayName: string,
): void {
	mcpServerActionsStore.start(target, serverName);
	void (async () => {
		try {
			await mcpServersService.reconnect(target, serverName);
		} catch (error) {
			toast.error(`Could not reconnect ${displayName} · ${errorMessage(error, 'unknown error')}`);
		} finally {
			mcpServerActionsStore.finish(target, serverName);
		}
	})();
}
