import type { McpFixQueue } from '$lib/chat/domain/mcp-server';
import { mcpFixQueueStore } from '$lib/chat/infrastructure/stores/mcp-fix-queue.store.svelte';

export { mcpFixQueueQuery };

class McpFixQueueQuery {
	public readonly data: McpFixQueue | null = $derived(mcpFixQueueStore.queue);
}

const mcpFixQueueQuery = new McpFixQueueQuery();
