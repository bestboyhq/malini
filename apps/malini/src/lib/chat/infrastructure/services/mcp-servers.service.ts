import { CHAT_MCP_SERVER_CHANGED_CHANNEL } from '$contract/events';
import type { McpServerTarget } from '$contract/mcp-servers';
import type { McpServer, McpServerInventory } from '$lib/chat/domain/mcp-server';
import { McpServerMapper } from '$lib/chat/infrastructure/mappers/mcp-server.mapper';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class McpServersService {
	async list(workstreamId: string | null): Promise<McpServerInventory> {
		const { servers, turnedOff } = await invoke('chat.list-mcp-servers', { workstreamId });
		return { servers: McpServerMapper.fromRawList(servers), turnedOff: [...turnedOff] };
	}

	async turnedOff(): Promise<string[]> {
		return [...(await invoke('chat.turned-off-mcp-servers', undefined))];
	}

	async switchServer(serverName: string, on: boolean): Promise<string[]> {
		return [...(await invoke('chat.switch-mcp-server', { serverName, on }))];
	}

	async authorize(target: McpServerTarget, serverName: string): Promise<string | null> {
		const { authUrl } = await invoke('chat.authorize-mcp-server', { ...target, serverName });
		return authUrl;
	}

	cancelSignIn(serverName: string): Promise<void> {
		return invoke('chat.cancel-mcp-sign-in', { serverName });
	}

	reconnect(target: McpServerTarget, serverName: string): Promise<void> {
		return invoke('chat.reconnect-mcp-server', { ...target, serverName });
	}

	onChanged(listener: (server: McpServer) => void): () => void {
		return onPlatformEvent(CHAT_MCP_SERVER_CHANGED_CHANNEL, (raw) =>
			listener(McpServerMapper.fromRaw(raw)),
		);
	}
}

export const mcpServersService = new McpServersService();
