import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isRecord } from '$main/db/rows';
import { readJsonObject, type JsonObject } from '$lib/skills/skills.platform';
import type { AgentSetup, LocalMcpServer } from '../domain/catalog-names';

export type ClaudeFiles = Readonly<{ settings: string; state: string }>;

export const OFFICIAL_MARKETPLACE = 'claude-plugins-official';
const OFFICIAL_REPOSITORY = 'anthropics/claude-plugins-official';

type InstalledPlugin = Readonly<{ id: string; name: string; paths: readonly string[] }>;

export async function readAgentSetup(
	files: ClaudeFiles,
	checkouts: readonly string[],
): Promise<AgentSetup> {
	const home = dirname(files.settings);
	const [installed, known, state, personal, repositories, projectServers] = await Promise.all([
		jsonObject(join(home, 'plugins', 'installed_plugins.json')),
		jsonObject(join(home, 'plugins', 'known_marketplaces.json')),
		jsonObject(files.state),
		localSkills(home),
		Promise.all(checkouts.map((checkout) => localSkills(join(checkout, '.claude')))),
		Promise.all(checkouts.map((checkout) => jsonObject(join(checkout, '.mcp.json')))),
	]);
	const plugins = installedPlugins(installed['plugins']);
	const projects = isRecord(state['projects']) ? Object.values(state['projects']) : [];
	const pluginServers = await Promise.all(plugins.map(serversOfPlugin));
	return {
		plugins: officialMarketplace(known)
			? plugins.flatMap(({ id }) => (id.endsWith(`@${OFFICIAL_MARKETPLACE}`) ? [id] : []))
			: [],
		localSkills: [...personal, ...repositories.flat()],
		mcpServers: [
			...[state, ...projects, ...projectServers].flatMap((config) =>
				isRecord(config) ? mcpServers(config['mcpServers'], '') : [],
			),
			...pluginServers.flat(),
		],
	};
}

export function officialMarketplace(known: JsonObject): boolean {
	const entry = known[OFFICIAL_MARKETPLACE];
	const source = isRecord(entry) ? entry['source'] : null;
	return (
		isRecord(source) &&
		source['source'] === 'github' &&
		typeof source['repo'] === 'string' &&
		source['repo'].toLowerCase() === OFFICIAL_REPOSITORY
	);
}

function installedPlugins(value: unknown): InstalledPlugin[] {
	if (!isRecord(value)) return [];
	return Object.entries(value).flatMap(([id, installs]) => {
		const at = id.lastIndexOf('@');
		if (at <= 0 || !Array.isArray(installs)) return [];
		const paths = installs.flatMap((install) =>
			isRecord(install) && typeof install['installPath'] === 'string'
				? [install['installPath']]
				: [],
		);
		return [{ id, name: id.slice(0, at), paths }];
	});
}

async function serversOfPlugin({ name, paths }: InstalledPlugin): Promise<LocalMcpServer[]> {
	const prefix = `plugin_${name}_`;
	const found = await Promise.all(
		paths.map(async (path) => {
			const [mcp, manifest] = await Promise.all([
				jsonObject(join(path, '.mcp.json')),
				jsonObject(join(path, '.claude-plugin', 'plugin.json')),
			]);
			const declared = manifest['mcpServers'];
			const linked = typeof declared === 'string' ? await jsonObject(join(path, declared)) : null;
			return [
				...mcpServers(isRecord(mcp['mcpServers']) ? mcp['mcpServers'] : mcp, prefix),
				...mcpServers(
					linked && isRecord(linked['mcpServers']) ? linked['mcpServers'] : linked,
					prefix,
				),
				...mcpServers(declared, prefix),
			];
		}),
	);
	return found.flat();
}

async function localSkills(folder: string): Promise<string[]> {
	const [skills, commands] = await Promise.all([
		names(join(folder, 'skills')),
		names(join(folder, 'commands')),
	]);
	return [...skills, ...commands.map((name) => name.replace(/\.md$/u, ''))];
}

async function names(folder: string): Promise<string[]> {
	try {
		return await readdir(folder);
	} catch {
		return [];
	}
}

async function jsonObject(path: string): Promise<JsonObject> {
	try {
		return await readJsonObject(path);
	} catch {
		return {};
	}
}

function mcpServers(value: unknown, prefix: string): LocalMcpServer[] {
	if (!isRecord(value)) return [];
	return Object.entries(value).flatMap(([key, server]) => {
		if (!isRecord(server)) return [];
		const { command, args, url } = server;
		if (typeof command !== 'string' && typeof url !== 'string') return [];
		return [
			{
				key: `${prefix}${key}`,
				command: typeof command === 'string' ? command : null,
				args: Array.isArray(args)
					? args.filter((arg): arg is string => typeof arg === 'string')
					: [],
				url: typeof url === 'string' ? url : null,
			},
		];
	});
}
