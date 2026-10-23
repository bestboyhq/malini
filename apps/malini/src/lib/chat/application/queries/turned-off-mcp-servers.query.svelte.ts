import { mcpServersAggregate } from '$lib/chat/infrastructure/aggregates/mcp-servers.aggregate.svelte';

export { turnedOffMcpServersQuery };

class TurnedOffMcpServersQuery {
	public readonly data: readonly string[] = $derived(mcpServersAggregate.turnedOff);
}

const turnedOffMcpServersQuery = new TurnedOffMcpServersQuery();
