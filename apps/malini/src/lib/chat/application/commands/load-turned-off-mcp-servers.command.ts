import { mcpServersAggregate } from '$lib/chat/infrastructure/aggregates/mcp-servers.aggregate.svelte';

export { loadTurnedOffMcpServersCommand };

function loadTurnedOffMcpServersCommand(): void {
	void mcpServersAggregate.loadTurnedOff().catch(() => undefined);
}
