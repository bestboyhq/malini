export type CatalogPlugin = Readonly<{
	id: string;
	skills: readonly string[];
	mcpServers: readonly string[];
}>;

export type CatalogMcpServer = Readonly<{
	name: string;
	packages: readonly string[];
	remotes: readonly string[];
}>;

export type StatsCatalog = Readonly<{
	skills: readonly string[];
	plugins: readonly CatalogPlugin[];
	mcpServers: readonly CatalogMcpServer[];
}>;

export type LocalMcpServer = Readonly<{
	key: string;
	command: string | null;
	args: readonly string[];
	url: string | null;
}>;

export type AgentSetup = Readonly<{
	plugins: readonly string[];
	localSkills: readonly string[];
	mcpServers: readonly LocalMcpServer[];
}>;

export type CatalogNames = Readonly<{
	skill(name: string): string;
	mcpServer(tool: string): string | null;
}>;

export const MALINI_SERVER = 'malini';

const OTHER = 'other';
const MCP_PREFIX = 'mcp__';

export const NO_SETUP: AgentSetup = { plugins: [], localSkills: [], mcpServers: [] };

export function catalogNames(catalog: StatsCatalog | null, setup: AgentSetup): CatalogNames {
	const pluginsByName = new Map<string, string[]>();
	for (const id of setup.plugins) {
		const name = pluginName(id);
		if (name) pluginsByName.set(name, [...(pluginsByName.get(name) ?? []), id]);
	}
	const catalogPlugins = new Map((catalog?.plugins ?? []).map((plugin) => [plugin.id, plugin]));
	const installed = new Map<string, CatalogPlugin>();
	for (const [name, ids] of pluginsByName) {
		const plugin = ids.length === 1 && ids[0] ? catalogPlugins.get(ids[0]) : undefined;
		if (plugin) installed.set(name, plugin);
	}
	const builtIn = new Set(catalog?.skills ?? []);
	for (const local of setup.localSkills) builtIn.delete(local);

	const pluginServers = new Map<string, string>();
	for (const [name, plugin] of installed) {
		for (const server of plugin.mcpServers) {
			pluginServers.set(toolSegment(`plugin_${name}_${server}`), `${name}:${server}`);
		}
	}
	const configured = registryServers(catalog?.mcpServers ?? [], setup.mcpServers);

	return {
		skill(name) {
			const colon = name.indexOf(':');
			if (colon === -1) return builtIn.has(name) ? name : OTHER;
			const plugin = installed.get(name.slice(0, colon));
			const skill = name.slice(colon + 1);
			return plugin?.skills.includes(skill) ? name : OTHER;
		},
		mcpServer(tool) {
			if (!tool.startsWith(MCP_PREFIX)) return null;
			const end = tool.indexOf('__', MCP_PREFIX.length);
			const server = tool.slice(MCP_PREFIX.length, end === -1 ? undefined : end);
			if (server === MALINI_SERVER) return MALINI_SERVER;
			return configured.get(server) ?? pluginServers.get(server) ?? OTHER;
		},
	};
}

export function parseCatalog(value: unknown): StatsCatalog | null {
	if (!isObject(value) || !Array.isArray(value['plugins']) || !Array.isArray(value['mcpServers'])) {
		return null;
	}
	return {
		skills: strings(value['skills']),
		plugins: value['plugins'].filter(isObject).flatMap((plugin): CatalogPlugin[] =>
			typeof plugin['id'] === 'string'
				? [
						{
							id: plugin['id'],
							skills: strings(plugin['skills']),
							mcpServers: strings(plugin['mcpServers']),
						},
					]
				: [],
		),
		mcpServers: value['mcpServers'].filter(isObject).flatMap((server): CatalogMcpServer[] => {
			const packages = strings(server['packages']);
			const remotes = strings(server['remotes']);
			if (typeof server['name'] !== 'string' || packages.length + remotes.length === 0) return [];
			return [{ name: server['name'], packages, remotes }];
		}),
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function registryServers(
	registry: readonly CatalogMcpServer[],
	local: readonly LocalMcpServer[],
): Map<string, string> {
	const byRemote = new Map<string, string>();
	const byPackage = new Map<string, string>();
	for (const server of registry) {
		for (const remote of server.remotes) byRemote.set(remoteKey(remote), server.name);
		for (const name of server.packages) byPackage.set(name, server.name);
	}
	const matches = new Map<string, Set<string | null>>();
	for (const server of local) {
		const segment = toolSegment(server.key);
		const match = registryMatch(server, byRemote, byPackage);
		matches.set(segment, (matches.get(segment) ?? new Set()).add(match));
	}
	const names = new Map<string, string>();
	for (const [segment, found] of matches) {
		const [only] = found;
		if (found.size === 1 && only) names.set(segment, only);
	}
	return names;
}

function registryMatch(
	server: LocalMcpServer,
	byRemote: ReadonlyMap<string, string>,
	byPackage: ReadonlyMap<string, string>,
): string | null {
	if (server.url !== null) return byRemote.get(remoteKey(server.url)) ?? null;
	for (const word of [server.command ?? '', ...server.args]) {
		const name =
			byPackage.get(word) ?? byPackage.get(unversioned(word)) ?? byRemote.get(remoteKey(word));
		if (name) return name;
	}
	return null;
}

function unversioned(word: string): string {
	const at = word.lastIndexOf('@');
	if (at > 0) return word.slice(0, at);
	const pinned = word.search(/==|:/u);
	return pinned > 0 ? word.slice(0, pinned) : word;
}

function remoteKey(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/u, '')}`;
	} catch {
		return url;
	}
}

function pluginName(id: string): string | null {
	const at = id.lastIndexOf('@');
	return at > 0 ? id.slice(0, at) : null;
}

function toolSegment(name: string): string {
	return name.replace(/[^A-Za-z0-9_-]/gu, '_');
}
