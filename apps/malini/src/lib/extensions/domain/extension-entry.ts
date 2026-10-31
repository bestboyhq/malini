import type { ExtensionListing, ExtensionServer, InstalledExtension } from '$contract/marketplace';
import { isNewerVersion, serverHosts } from './marketplace-manifest';

export type ExtensionUpdate = Readonly<{ version: string; newHosts: readonly string[] }>;

export type ExtensionEntry = Readonly<{
	key: string;
	publisher: string;
	name: string;
	displayName: string;
	description: string;
	version: string;
	repository: string | null;
	mcpServers: readonly ExtensionServer[];
	skills: readonly string[];
	installed: InstalledExtension | null;
	update: ExtensionUpdate | null;
}>;

export function extensionKey(publisher: string, name: string): string {
	return `${publisher}/${name}`;
}

export function discoverEntries(
	listings: readonly ExtensionListing[],
	installed: readonly InstalledExtension[],
): ExtensionEntry[] {
	return listings.map((listing) => {
		const mine = installedOf(installed, listing.publisher, listing.name);
		return { ...entryOf(listing), installed: mine, update: mine ? updateOf(mine, listing) : null };
	});
}

export function installedEntries(
	installed: readonly InstalledExtension[],
	listings: readonly ExtensionListing[],
): ExtensionEntry[] {
	return installed.map((extension) => {
		const listing = listings.find(
			(each) => each.publisher === extension.publisher && each.name === extension.name,
		);
		return {
			...entryOf(extension),
			installed: extension,
			update: listing ? updateOf(extension, listing) : null,
		};
	});
}

export function entryMatches(entry: ExtensionEntry, query: string): boolean {
	const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
	if (words.length === 0) return true;
	const text = [
		entry.displayName,
		entry.description,
		`@${entry.publisher}`,
		entry.name,
		...entry.skills,
		...entry.mcpServers.map((server) => server.name),
	]
		.join(' ')
		.toLowerCase();
	return words.every((word) => text.includes(word));
}

export function contributionSummary(entry: Pick<ExtensionEntry, 'mcpServers' | 'skills'>): string {
	const parts = [
		counted(entry.mcpServers.length, 'MCP server', 'MCP servers'),
		counted(entry.skills.length, 'skill', 'skills'),
	];
	return parts.filter(Boolean).join(' · ');
}

function entryOf(
	source: ExtensionListing | InstalledExtension,
): Omit<ExtensionEntry, 'installed' | 'update'> {
	return {
		key: extensionKey(source.publisher, source.name),
		publisher: source.publisher,
		name: source.name,
		displayName: source.displayName,
		description: source.description,
		version: source.version,
		repository: source.repository,
		mcpServers: source.mcpServers,
		skills: source.skills,
	};
}

function installedOf(
	installed: readonly InstalledExtension[],
	publisher: string,
	name: string,
): InstalledExtension | null {
	return installed.find((each) => each.publisher === publisher && each.name === name) ?? null;
}

function updateOf(
	installed: InstalledExtension,
	listing: ExtensionListing,
): ExtensionUpdate | null {
	if (!isNewerVersion(listing.version, installed.version)) return null;
	const hosts = new Set(serverHosts(installed.mcpServers));
	return {
		version: listing.version,
		newHosts: serverHosts(listing.mcpServers).filter((host) => !hosts.has(host)),
	};
}

function counted(count: number, one: string, many: string): string {
	if (count === 0) return '';
	return `${count} ${count === 1 ? one : many}`;
}
