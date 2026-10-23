import { mcpServersAggregate } from '$lib/chat/infrastructure/aggregates/mcp-servers.aggregate.svelte';

export { watchMcpServersCommand };

function watchMcpServersCommand(workstreamId: string | null, restart = false): void {
	void mcpServersAggregate.watch(workstreamId, restart);
}
