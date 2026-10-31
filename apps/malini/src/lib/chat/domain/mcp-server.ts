import type { McpServerReport } from '$contract/mcp-servers';

export type McpServerStatus = 'connected' | 'pending' | 'failed' | 'needs-auth' | 'disabled';

export type McpServerOrigin =
	| Readonly<{ kind: 'claude-ai' }>
	| Readonly<{ kind: 'plugin'; plugin: string }>
	| Readonly<{ kind: 'user' }>
	| Readonly<{ kind: 'project' }>
	| Readonly<{ kind: 'local' }>
	| Readonly<{ kind: 'other' }>;

export type McpServer = Readonly<{
	name: string;
	displayName: string;
	status: McpServerStatus;
	error: string | null;
	origin: McpServerOrigin;
	toolCount: number | null;
}>;

export type McpServerFix = 'sign-in' | 'reconnect-on-claude-ai' | 'retry' | 'duplicate';

export type McpServerGroups = Readonly<{
	signIn: readonly McpServer[];
	claudeAi: readonly McpServer[];
	failed: readonly McpServer[];
	duplicates: readonly McpServer[];
	connecting: readonly McpServer[];
	ready: readonly McpServer[];
	off: readonly McpServer[];
}>;

export type McpServerSection = Readonly<{
	key: string;
	label: string;
	detail: string | null;
	servers: readonly McpServer[];
}>;

export type McpFixOutcome = 'to-do' | 'working' | 'fixed' | 'skipped' | 'off';

export type McpFixStep = Readonly<{
	server: McpServer;
	fix: Exclude<McpServerFix, 'duplicate'>;
	outcome: McpFixOutcome;
	error: string | null;
}>;

export type McpServerInventory = Readonly<{
	servers: readonly McpServer[];
	settled: boolean;
	turnedOff: readonly string[];
}>;

export type ListedMcpServers = Readonly<{
	workstreamId: string | null;
	servers: readonly McpServer[];
	settled: boolean;
	error: string | null;
}>;

export type McpServerListing = Readonly<{
	state: 'idle' | 'loading' | 'ready' | 'error';
	servers: readonly McpServer[];
	error: string | null;
}>;

export type McpFixQueue = Readonly<{
	workstreamId: string | null;
	steps: readonly McpFixStep[];
	index: number;
}>;

export const IDLE_MCP_SERVER_LISTING: McpServerListing = {
	state: 'idle',
	servers: [],
	error: null,
};

export const CLAUDE_AI_CONNECTORS_URL = 'https://claude.ai/settings/connectors';

const MCP_SERVER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
	'codebase-memory-mcp': 'Codebase Memory',
	'computer-use': 'Computer Use',
	github: 'GitHub',
	linear: 'Linear',
	node_repl: 'Node REPL',
	svelte: 'Svelte',
};

export function mcpServer(report: McpServerReport): McpServer {
	return {
		name: report.name,
		displayName: mcpServerDisplayName(report.name),
		status: mcpServerStatus(report.status),
		error: report.error?.trim() || null,
		origin: mcpServerOrigin(report.name, report.source),
		toolCount:
			report.toolCount !== undefined && Number.isFinite(report.toolCount)
				? Math.max(0, Math.floor(report.toolCount))
				: null,
	};
}

export function mcpServerDisplayName(serverId: string): string {
	const trimmed = serverId
		.trim()
		.replace(/^plugin(?::[^:]+:|_[^_]+_)/iu, '')
		.replace(/^claude\.ai\s+/iu, '');
	const known = MCP_SERVER_DISPLAY_NAMES[trimmed.toLowerCase()];
	if (known) return known;
	const normalized = trimmed
		.replace(/^mcp[-_:./]+/iu, '')
		.replace(/[-_:./]+mcp$/iu, '')
		.replace(/[-_:./]+/gu, ' ')
		.trim();
	if (!normalized) return trimmed || 'MCP server';
	return normalized
		.split(/\s+/u)
		.map((token) => {
			const lower = token.toLowerCase();
			if (lower === 'mcp') return 'MCP';
			if (lower === 'repl') return 'REPL';
			if (lower === 'api') return 'API';
			return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
		})
		.join(' ');
}

export function mcpServerStatus(value: string): McpServerStatus {
	if (
		value === 'connected' ||
		value === 'pending' ||
		value === 'needs-auth' ||
		value === 'disabled'
	) {
		return value;
	}
	return 'failed';
}

export function mcpServerOrigin(name: string, source: string | undefined): McpServerOrigin {
	const plugin = /^plugin:([^:]+):/iu.exec(name)?.[1];
	if (source === 'claudeai' || /^claude\.ai\s/iu.test(name)) return { kind: 'claude-ai' };
	if (plugin) return { kind: 'plugin', plugin };
	if (source === 'user') return { kind: 'user' };
	if (source === 'project') return { kind: 'project' };
	if (source === 'local') return { kind: 'local' };
	return { kind: 'other' };
}

export function mcpOriginTag(origin: McpServerOrigin): string {
	switch (origin.kind) {
		case 'claude-ai':
			return 'claude.ai';
		case 'plugin':
			return origin.plugin;
		case 'user':
			return 'yours';
		case 'project':
			return 'repository';
		case 'local':
			return 'this folder';
		case 'other':
			return 'other';
	}
}

export function mcpOriginLabel(origin: McpServerOrigin): string {
	return sectionOf(origin, null).label;
}

export function isTurnedOff(server: McpServer, turnedOff: readonly string[]): boolean {
	return server.status === 'disabled' || turnedOff.includes(server.name);
}

export function mcpServerFix(
	server: McpServer,
	servers: readonly McpServer[],
): McpServerFix | null {
	if (server.status !== 'needs-auth' && server.status !== 'failed') return null;
	if (hasConnectedTwin(server, servers)) return 'duplicate';
	if (server.status === 'needs-auth') return 'sign-in';
	if (server.origin.kind === 'claude-ai') return 'reconnect-on-claude-ai';
	return 'retry';
}

export function sharesDisplayName(server: McpServer, servers: readonly McpServer[]): boolean {
	return servers.some((other) => other.name !== server.name && sameService(other, server));
}

export function groupMcpServers(
	servers: readonly McpServer[],
	turnedOff: readonly string[],
): McpServerGroups {
	const on = servers.filter((server) => !isTurnedOff(server, turnedOff));
	const fixes = new Map(on.map((server) => [server.name, mcpServerFix(server, on)]));
	const withFix = (fix: McpServerFix): McpServer[] =>
		on.filter((server) => fixes.get(server.name) === fix);
	return {
		signIn: withFix('sign-in'),
		claudeAi: withFix('reconnect-on-claude-ai'),
		failed: withFix('retry'),
		duplicates: withFix('duplicate'),
		connecting: on.filter((server) => server.status === 'pending'),
		ready: on.filter((server) => server.status === 'connected'),
		off: servers.filter((server) => isTurnedOff(server, turnedOff)),
	};
}

export function mcpFixSteps(groups: McpServerGroups): McpFixStep[] {
	const step =
		(fix: McpFixStep['fix']) =>
		(server: McpServer): McpFixStep => ({ server, fix, outcome: 'to-do', error: null });
	return [
		...groups.signIn.map(step('sign-in')),
		...groups.claudeAi.map(step('reconnect-on-claude-ai')),
		...groups.failed.map(step('retry')),
	];
}

export function nextFixStep(steps: readonly McpFixStep[], after: number): number {
	const next = steps.findIndex((step, index) => index > after && step.outcome === 'to-do');
	return next === -1 ? steps.length : next;
}

export function needsYouCount(groups: McpServerGroups): number {
	return (
		groups.signIn.length + groups.claudeAi.length + groups.failed.length + groups.duplicates.length
	);
}

export function withServerUpdates(
	servers: readonly McpServer[],
	updates: ReadonlyMap<string, McpServer>,
): McpServer[] {
	return servers.map((server) => {
		const update = updates.get(server.name);
		if (!update) return server;
		return { ...update, origin: server.origin, toolCount: update.toolCount ?? server.toolCount };
	});
}

export function withTurnedOffListed(
	servers: readonly McpServer[],
	turnedOff: readonly string[],
): McpServer[] {
	const listed = new Set(servers.map(({ name }) => name));
	const hidden = turnedOff
		.filter((name) => !listed.has(name))
		.map((name) => mcpServer({ name, status: 'disabled' }));
	return [...servers, ...hidden];
}

export function mcpServerSections(
	servers: readonly McpServer[],
	repository: string | null,
): McpServerSection[] {
	const sections = new Map<
		string,
		{ label: string; detail: string | null; servers: McpServer[] }
	>();
	for (const server of servers) {
		const { key, label, detail } = sectionOf(server.origin, repository);
		const section = sections.get(key) ?? { label, detail, servers: [] };
		section.servers.push(server);
		sections.set(key, section);
	}
	return [...sections]
		.map(([key, section]) => ({ key, ...section }))
		.sort(
			(left, right) =>
				sectionRank(left.key) - sectionRank(right.key) || left.label.localeCompare(right.label),
		);
}

function sectionOf(
	origin: McpServerOrigin,
	repository: string | null,
): { key: string; label: string; detail: string | null } {
	switch (origin.kind) {
		case 'claude-ai':
			return {
				key: 'claude-ai',
				label: 'claude.ai connectors',
				detail: 'claude.ai/settings/connectors',
			};
		case 'plugin':
			return { key: `plugin:${origin.plugin}`, label: `Plugin · ${origin.plugin}`, detail: null };
		case 'user':
			return { key: 'user', label: 'Your servers', detail: '~/.claude.json' };
		case 'project':
			return { key: 'project', label: repository ?? 'This repository', detail: '.mcp.json' };
		case 'local':
			return { key: 'local', label: 'This folder only', detail: '~/.claude.json' };
		case 'other':
			return { key: 'other', label: 'Other servers', detail: null };
	}
}

function sectionRank(key: string): number {
	if (key === 'claude-ai') return 0;
	if (key.startsWith('plugin:')) return 1;
	if (key === 'user') return 2;
	if (key === 'project') return 3;
	if (key === 'local') return 4;
	return 5;
}

function hasConnectedTwin(server: McpServer, servers: readonly McpServer[]): boolean {
	return servers.some(
		(other) =>
			other.name !== server.name && other.status === 'connected' && sameService(other, server),
	);
}

function sameService(left: McpServer, right: McpServer): boolean {
	return left.displayName.toLowerCase() === right.displayName.toLowerCase();
}
