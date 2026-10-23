import { mcpServersAggregate } from '$lib/chat/infrastructure/aggregates/mcp-servers.aggregate.svelte';

export { loadMcpServersCommand };

function loadMcpServersCommand(workstreamId: string | null): void {
	void mcpServersAggregate.load(workstreamId);
}
