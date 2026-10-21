import type { SessionId } from '$lib/chat/domain/session';
import {
	mcpServerActionsStore,
	mcpServerKey,
} from '$lib/chat/infrastructure/stores/mcp-server-actions.store.svelte';

export { mcpServerBusyQuery };

class McpServerBusyQuery {
	public readonly data: (sessionId: SessionId, serverName: string) => boolean = $derived(
		(sessionId: SessionId, serverName: string) =>
			mcpServerActionsStore.busy.has(mcpServerKey(sessionId, serverName)),
	);
}

const mcpServerBusyQuery = new McpServerBusyQuery();
