import type { ExtensionServer, InstalledExtension } from '$contract/marketplace';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';

type InstalledExtensionRow = {
	name: string;
	publisher: string;
	version: string;
	display_name: string;
	description: string;
	repository: string | null;
	mcp_servers: string;
	skills: string;
	sha256: string;
	enabled: number;
	withdrawn: number;
	installed_at: string;
};

export type InstalledExtensionRecord = InstalledExtension & Readonly<{ sha256: string }>;

const COLUMNS =
	'name, publisher, version, display_name, description, repository, mcp_servers, skills, sha256, enabled, withdrawn, installed_at';

export function listInstalledExtensions(db: MaliniDatabase): InstalledExtensionRecord[] {
	return all<InstalledExtensionRow>(
		db,
		`SELECT ${COLUMNS} FROM installed_extensions ORDER BY display_name COLLATE NOCASE`,
	).map(fromRow);
}

export function getInstalledExtension(
	db: MaliniDatabase,
	name: string,
): InstalledExtensionRecord | null {
	const row = get<InstalledExtensionRow>(
		db,
		`SELECT ${COLUMNS} FROM installed_extensions WHERE name = ?`,
		name,
	);
	return row ? fromRow(row) : null;
}

export function saveInstalledExtension(db: MaliniDatabase, record: InstalledExtensionRecord): void {
	run(
		db,
		`INSERT INTO installed_extensions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET
			publisher = excluded.publisher,
			version = excluded.version,
			display_name = excluded.display_name,
			description = excluded.description,
			repository = excluded.repository,
			mcp_servers = excluded.mcp_servers,
			skills = excluded.skills,
			sha256 = excluded.sha256,
			enabled = excluded.enabled,
			withdrawn = excluded.withdrawn,
			installed_at = excluded.installed_at`,
		record.name,
		record.publisher,
		record.version,
		record.displayName,
		record.description,
		record.repository,
		JSON.stringify(record.mcpServers),
		JSON.stringify(record.skills),
		record.sha256,
		record.enabled,
		record.withdrawn,
		record.installedAt,
	);
}

export function switchInstalledExtension(db: MaliniDatabase, name: string, enabled: boolean): void {
	run(db, 'UPDATE installed_extensions SET enabled = ? WHERE name = ?', enabled, name);
}

export function withdrawInstalledExtension(db: MaliniDatabase, name: string): void {
	run(db, 'UPDATE installed_extensions SET enabled = 0, withdrawn = 1 WHERE name = ?', name);
}

export function deleteInstalledExtension(db: MaliniDatabase, name: string): void {
	run(db, 'DELETE FROM installed_extensions WHERE name = ?', name);
}

function fromRow(row: InstalledExtensionRow): InstalledExtensionRecord {
	return {
		name: row.name,
		publisher: row.publisher,
		version: row.version,
		displayName: row.display_name,
		description: row.description,
		repository: row.repository,
		mcpServers: servers(row.mcp_servers),
		skills: strings(row.skills),
		sha256: row.sha256,
		enabled: row.enabled === 1,
		withdrawn: row.withdrawn === 1,
		installedAt: row.installed_at,
	};
}

function servers(json: string): ExtensionServer[] {
	const parsed: unknown = JSON.parse(json);
	if (!Array.isArray(parsed)) return [];
	const entries: readonly unknown[] = parsed;
	return entries.flatMap((entry) =>
		typeof entry === 'object' &&
		entry !== null &&
		'name' in entry &&
		'url' in entry &&
		typeof entry.name === 'string' &&
		typeof entry.url === 'string'
			? [{ name: entry.name, url: entry.url }]
			: [],
	);
}

function strings(json: string): string[] {
	const parsed: unknown = JSON.parse(json);
	if (!Array.isArray(parsed)) return [];
	const entries: readonly unknown[] = parsed;
	return entries.filter((entry): entry is string => typeof entry === 'string');
}
