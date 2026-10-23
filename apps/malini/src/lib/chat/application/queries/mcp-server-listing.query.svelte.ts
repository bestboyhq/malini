import {
	withServerUpdates,
	withTurnedOffListed,
	type McpServerListing,
} from '$lib/chat/domain/mcp-server';
import { mcpServersAggregate } from '$lib/chat/infrastructure/aggregates/mcp-servers.aggregate.svelte';

export { mcpServerListingQuery };

class McpServerListingQuery {
	public readonly data: (workstreamId: string | null) => McpServerListing = $derived(
		(workstreamId: string | null) => {
			const listing = mcpServersAggregate.listing(workstreamId);
			if (listing.state !== 'ready' && listing.servers.length === 0) return listing;
			const servers = withServerUpdates(listing.servers, mcpServersAggregate.updates);
			return { ...listing, servers: withTurnedOffListed(servers, mcpServersAggregate.turnedOff) };
		},
	);
}

const mcpServerListingQuery = new McpServerListingQuery();
