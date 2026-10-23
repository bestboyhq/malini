import {
	IDLE_MCP_SERVER_LISTING,
	type ListedMcpServers,
	type McpServer,
	type McpServerListing,
} from '$lib/chat/domain/mcp-server';
import { errorMessage } from '$lib/chat/domain/error-message';
import { mcpServersService } from '$lib/chat/infrastructure/services/mcp-servers.service';

class McpServersAggregate {
	listings = $state.raw<ReadonlyMap<string, McpServerListing>>(new Map());
	turnedOff = $state.raw<readonly string[]>([]);
	updates = $state.raw<ReadonlyMap<string, McpServer>>(new Map());

	#generations = new Map<string, number>();
	#turnedOffGeneration = 0;

	listing(workstreamId: string | null): McpServerListing {
		return this.listings.get(listingKey(workstreamId)) ?? IDLE_MCP_SERVER_LISTING;
	}

	async watch(workstreamId: string | null, restart: boolean): Promise<void> {
		const key = listingKey(workstreamId);
		const generation = (this.#generations.get(key) ?? 0) + 1;
		this.#generations.set(key, generation);
		const current = this.listing(workstreamId);
		if (restart || current.state !== 'ready') {
			this.#setListing(key, { ...current, state: 'loading', error: null });
		}
		try {
			const { servers, settled, turnedOff } = await mcpServersService.watch(workstreamId, restart);
			if (this.#generations.get(key) !== generation) return;
			this.replaceTurnedOff(turnedOff);
			this.#show(key, servers, settled && !restart);
		} catch (error) {
			if (this.#generations.get(key) !== generation) return;
			this.#setListing(key, {
				...this.listing(workstreamId),
				state: 'error',
				error: errorMessage(error, 'unknown error'),
			});
		}
	}

	listed({ workstreamId, servers, settled, error }: ListedMcpServers): void {
		const key = listingKey(workstreamId);
		if (error === null) {
			this.#show(key, servers, settled);
			return;
		}
		this.#setListing(key, { ...this.listing(workstreamId), state: 'error', error });
	}

	async loadTurnedOff(): Promise<void> {
		const generation = ++this.#turnedOffGeneration;
		const turnedOff = await mcpServersService.turnedOff();
		if (generation === this.#turnedOffGeneration) this.turnedOff = turnedOff;
	}

	replaceTurnedOff(turnedOff: readonly string[]): void {
		this.#turnedOffGeneration += 1;
		this.turnedOff = turnedOff;
	}

	update(server: McpServer): void {
		this.updates = new Map([...this.updates, [server.name, server]]);
	}

	#show(key: string, servers: readonly McpServer[], settled: boolean): void {
		this.updates = withoutUpdatesFor(this.updates, servers);
		this.#setListing(key, { state: settled ? 'ready' : 'loading', servers, error: null });
	}

	#setListing(key: string, listing: McpServerListing): void {
		this.listings = new Map([...this.listings, [key, listing]]);
	}
}

function listingKey(workstreamId: string | null): string {
	return workstreamId ?? '';
}

function withoutUpdatesFor(
	updates: ReadonlyMap<string, McpServer>,
	servers: readonly McpServer[],
): ReadonlyMap<string, McpServer> {
	const listed = new Set(servers.map(({ name }) => name));
	return new Map([...updates].filter(([name]) => !listed.has(name)));
}

export const mcpServersAggregate = new McpServersAggregate();
