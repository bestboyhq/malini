export type McpServerReport = Readonly<{
	name: string;
	status: string;
	error?: string;
	source?: string;
	toolCount?: number;
}>;

export type McpServerTarget =
	Readonly<{ sessionId: string }> | Readonly<{ workstreamId: string | null }>;

export type McpServerArgs = McpServerTarget & Readonly<{ serverName: string }>;

export type McpAuthorization = Readonly<{ authUrl: string | null }>;

export type ListMcpServersArgs = Readonly<{ workstreamId: string | null }>;

export type McpServerList = Readonly<{
	servers: readonly McpServerReport[];
	turnedOff: readonly string[];
}>;

export type McpServerNameArgs = Readonly<{ serverName: string }>;

export type SwitchMcpServerArgs = Readonly<{ serverName: string; on: boolean }>;

export const MCP_SERVER_NAME_MAX_LENGTH = 200;
