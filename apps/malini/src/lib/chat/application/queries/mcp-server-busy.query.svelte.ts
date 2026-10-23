import type { McpServerTarget } from '$contract/mcp-servers';
import {
	mcpServerActionsStore,
	mcpServerKey,
} from '$lib/chat/infrastructure/stores/mcp-server-actions.store.svelte';

export { mcpServerBusyQuery };

class McpServerBusyQuery {
	public readonly data: (target: McpServerTarget, serverName: string) => boolean = $derived(
		(target: McpServerTarget, serverName: string) =>
			mcpServerActionsStore.busy.has(mcpServerKey(target, serverName)),
	);
}

const mcpServerBusyQuery = new McpServerBusyQuery();
