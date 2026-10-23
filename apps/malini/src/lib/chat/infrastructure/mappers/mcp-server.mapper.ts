import type { McpServerReport as RawMcpServer } from '$contract/mcp-servers';
import { mcpServer, type McpServer } from '$lib/chat/domain/mcp-server';

export class McpServerMapper {
	static fromRawList(raws: readonly RawMcpServer[]): McpServer[] {
		return raws.map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawMcpServer): McpServer {
		return mcpServer(raw);
	}
}
