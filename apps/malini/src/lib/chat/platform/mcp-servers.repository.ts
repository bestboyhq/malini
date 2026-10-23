import type { McpServerReport } from '$contract/mcp-servers';
import type { MaliniDatabase } from '$main/db/driver';
import { column, get, isRecord, nowIso8601, parseJsonColumn, run } from '$main/db/rows';

export function storedMcpServerListing(
	db: MaliniDatabase,
	folder: string,
): McpServerReport[] | null {
	const row = get<{ servers: string }>(
		db,
		'SELECT servers FROM mcp_server_listings WHERE folder = ?',
		folder,
	);
	return row ? mcpServerReports(row.servers) : null;
}

export function latestMcpServerListing(db: MaliniDatabase): McpServerReport[] | null {
	const row = get<{ servers: string }>(
		db,
		'SELECT servers FROM mcp_server_listings ORDER BY listed_at DESC LIMIT 1',
	);
	return row ? mcpServerReports(row.servers) : null;
}

export function storeMcpServerListing(
	db: MaliniDatabase,
	folder: string,
	servers: readonly McpServerReport[],
): void {
	run(
		db,
		`INSERT INTO mcp_server_listings (folder, servers, listed_at) VALUES (?, ?, ?)
		 ON CONFLICT(folder) DO UPDATE SET servers = excluded.servers, listed_at = excluded.listed_at`,
		folder,
		JSON.stringify(servers),
		nowIso8601(),
	);
}

export function foldersWithMcpServerOff(db: MaliniDatabase, serverName: string): string[] {
	return column(
		db,
		'SELECT folder FROM mcp_server_folder_offs WHERE server_name = ? ORDER BY folder',
		serverName,
	);
}

export function recordMcpServerOff(
	db: MaliniDatabase,
	serverName: string,
	folders: readonly string[],
): void {
	for (const folder of folders) {
		run(
			db,
			'INSERT OR IGNORE INTO mcp_server_folder_offs (server_name, folder) VALUES (?, ?)',
			serverName,
			folder,
		);
	}
}

export function forgetMcpServerOff(
	db: MaliniDatabase,
	serverName: string,
	folders: readonly string[],
): void {
	for (const folder of folders) {
		run(
			db,
			'DELETE FROM mcp_server_folder_offs WHERE server_name = ? AND folder = ?',
			serverName,
			folder,
		);
	}
}

function mcpServerReports(text: string): McpServerReport[] {
	const parsed = parseJsonColumn(text);
	if (!Array.isArray(parsed)) return [];
	return parsed.flatMap((value): McpServerReport[] => {
		if (!isRecord(value)) return [];
		const { name, status, error, source, toolCount } = value;
		if (typeof name !== 'string' || typeof status !== 'string') return [];
		return [
			{
				name,
				status,
				...(typeof error === 'string' ? { error } : {}),
				...(typeof source === 'string' ? { source } : {}),
				...(typeof toolCount === 'number' ? { toolCount } : {}),
			},
		];
	});
}
