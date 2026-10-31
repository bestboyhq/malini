import { homedir } from 'node:os';
import { CHAT_MCP_SERVERS_LISTED_CHANNEL } from '$contract/events';
import {
	MCP_SERVER_NAME_MAX_LENGTH,
	type McpServerList,
	type McpServerListing,
	type McpServerReport,
} from '$contract/mcp-servers';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord } from '$main/db/rows';
import type { EventBus } from '$main/events';
import type { CommandRegistry } from '$main/ipc/registry';
import { readJsonObject, updateClaudeSettings, type JsonObject } from '$lib/skills/skills.platform';
import type { AgentMcpServerListing, BridgeMcpServerTarget } from './agent/protocol';
import { SupervisorError, type BridgeSupervisor } from './agent/supervisor';
import type { WorkstreamCheckoutResolver } from './attachments/commands';
import {
	foldersWithMcpServerOff,
	forgetMcpServerOff,
	latestMcpServerListing,
	recordMcpServerOff,
	storeMcpServerListing,
	storedMcpServerListing,
} from './mcp-servers.repository';

type McpSupervisor = Pick<
	BridgeSupervisor,
	| 'watchMcpServers'
	| 'switchMcpServer'
	| 'authorizeMcpServer'
	| 'reconnectMcpServer'
	| 'cancelMcpAuthorization'
>;

export interface McpServerDeps {
	readonly db: MaliniDatabase;
	readonly events: EventBus;
	readonly runtime: {
		ensureReady(): Promise<McpSupervisor>;
		ensureSessionReady(sessionId: string): Promise<McpSupervisor>;
	};
	readonly claudeSettings: () => string;
	readonly resolveWorkstreamCheckout: WorkstreamCheckoutResolver;
	readonly plugins: () => readonly string[];
	readonly log: (line: string) => void;
}

export class McpServerListings {
	readonly #deps: McpServerDeps;
	readonly #workstreams = new Map<string, string | null>();
	readonly #shown = new Map<string, McpServerListing>();
	readonly #switching = new Map<string, Promise<string[]>>();
	readonly #turningOn = new Set<string>();
	#turnedOff: readonly string[] = [];

	constructor(deps: McpServerDeps) {
		this.#deps = deps;
	}

	received({ cwd, servers, settled, error }: AgentMcpServerListing): void {
		const workstreamId = this.#workstreams.get(cwd);
		if (workstreamId === undefined) return;
		const previous = this.#shown.get(cwd)?.servers ?? this.#cached(cwd);
		const shown =
			error === undefined
				? shownMcpServers(previous, servers, settled, this.#turnedOff, this.#turningOn)
				: previous;
		if (settled && error === undefined) storeMcpServerListing(this.#deps.db, cwd, shown);
		this.#show(cwd, {
			workstreamId,
			servers: shown,
			settled,
			...(error === undefined ? {} : { error }),
		});
	}

	#show(cwd: string, listing: McpServerListing): void {
		this.#shown.set(cwd, listing);
		this.#deps.events.emit(CHAT_MCP_SERVERS_LISTED_CHANNEL, listing);
	}

	#showConnecting(serverName: string): void {
		for (const [cwd, listing] of this.#shown) {
			if (
				!listing.servers.some(({ name, status }) => name === serverName && status === 'disabled')
			) {
				continue;
			}
			this.#show(cwd, {
				...listing,
				servers: listing.servers.map((server) =>
					server.name === serverName ? { ...server, status: 'pending' } : server,
				),
			});
		}
	}

	async watch(workstreamId: string | null, restart = false): Promise<McpServerList> {
		const cwd = await folder(workstreamId, this.#deps);
		this.#workstreams.set(cwd, workstreamId);
		this.#turnedOff = await readTurnedOffMcpServers(this.#deps.claudeSettings());
		const before = this.#shown.get(cwd);
		const supervisor = await this.#deps.runtime.ensureReady();
		await plainly(() => supervisor.watchMcpServers(cwd, this.#deps.plugins(), restart));
		const after = this.#shown.get(cwd);
		return {
			servers: after?.servers ?? this.#cached(cwd),
			settled: after !== before && after?.settled === true && after.error === undefined,
			turnedOff: this.#turnedOff,
		};
	}

	switchServer(serverName: string, on: boolean): Promise<string[]> {
		const previous = this.#switching.get(serverName);
		const switched = (async (): Promise<string[]> => {
			await previous?.catch(() => undefined);
			return this.#switch(serverName, on);
		})();
		this.#switching.set(serverName, switched);
		return switched;
	}

	async #switch(serverName: string, on: boolean): Promise<string[]> {
		if (on) {
			this.#turningOn.add(serverName);
			this.#showConnecting(serverName);
		}
		try {
			const settings = await updateClaudeSettings(this.#deps.claudeSettings(), (current) =>
				withMcpServerSwitched(current, serverName, on),
			);
			this.#turnedOff = turnedOffMcpServers(settings);
			await this.#switchLive(serverName, on);
			return [...this.#turnedOff];
		} finally {
			this.#turningOn.delete(serverName);
		}
	}

	async #switchLive(serverName: string, on: boolean): Promise<void> {
		try {
			const supervisor = await this.#deps.runtime.ensureReady();
			const folders = on ? foldersWithMcpServerOff(this.#deps.db, serverName) : [];
			const switched = await supervisor.switchMcpServer(
				serverName,
				on,
				folders,
				this.#deps.plugins(),
			);
			if (on) forgetMcpServerOff(this.#deps.db, serverName, switched);
			else recordMcpServerOff(this.#deps.db, serverName, switched);
		} catch (error) {
			this.#deps.log(
				`mcp: could not turn ${serverName} ${on ? 'on' : 'off'} in running Claude Code: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	#cached(cwd: string): McpServerReport[] {
		const stored = storedMcpServerListing(this.#deps.db, cwd);
		if (stored) return stored;
		return (latestMcpServerListing(this.#deps.db) ?? []).filter(
			({ source }) => source !== 'project' && source !== 'local',
		);
	}
}

export function shownMcpServers(
	previous: readonly McpServerReport[],
	incoming: readonly McpServerReport[],
	settled: boolean,
	turnedOff: readonly string[],
	turningOn: ReadonlySet<string> = new Set(),
): McpServerReport[] {
	const listed = new Map(incoming.map((server) => [server.name, server]));
	if (settled) {
		const kept = previous.flatMap(({ name, source }): McpServerReport[] => {
			if (listed.has(name)) return [];
			const status = turningOn.has(name) ? 'pending' : turnedOff.includes(name) ? 'disabled' : null;
			return status ? [{ name, status, ...(source ? { source } : {}) }] : [];
		});
		return [...incoming, ...kept];
	}
	const known = new Set(previous.map(({ name }) => name));
	const merged = previous.map((server) => {
		const fresh = listed.get(server.name);
		return fresh && (fresh.status !== 'pending' || server.status === 'pending') ? fresh : server;
	});
	return [...merged, ...incoming.filter(({ name }) => !known.has(name))];
}

export function defineMcpServerCommands(
	commands: CommandRegistry,
	deps: McpServerDeps,
): McpServerListings {
	const listings = new McpServerListings(deps);
	commands.define('chat.authorize-mcp-server', async (args: unknown) => {
		const serverName = requireServerName(args);
		const { supervisor, target } = await resolveTarget(args, deps);
		const authUrl = await plainly(() =>
			supervisor.authorizeMcpServer(target, serverName, deps.plugins()),
		);
		return { authUrl };
	});

	commands.define('chat.reconnect-mcp-server', async (args: unknown) => {
		const serverName = requireServerName(args);
		const { supervisor, target } = await resolveTarget(args, deps);
		await plainly(() => supervisor.reconnectMcpServer(target, serverName, deps.plugins()));
	});

	commands.define('chat.cancel-mcp-sign-in', async (args: unknown) => {
		const serverName = requireServerName(args);
		const supervisor = await deps.runtime.ensureReady();
		await plainly(() => supervisor.cancelMcpAuthorization(serverName));
	});

	commands.define('chat.watch-mcp-servers', (args: unknown) => {
		const restart = field(args, 'restart') ?? false;
		if (typeof restart !== 'boolean') throw new Error('invalid args: `restart` must be a boolean');
		return listings.watch(optionalWorkstreamId(args), restart);
	});

	commands.define('chat.turned-off-mcp-servers', () =>
		readTurnedOffMcpServers(deps.claudeSettings()),
	);

	commands.define('chat.switch-mcp-server', async (args: unknown) => {
		const serverName = requireServerName(args);
		const on = field(args, 'on');
		if (typeof on !== 'boolean') throw new Error('invalid args: `on` must be a boolean');
		return listings.switchServer(serverName, on);
	});

	return listings;
}

export function withMcpServerSwitched(settings: JsonObject, name: string, on: boolean): JsonObject {
	const denied = Array.isArray(settings['deniedMcpServers']) ? settings['deniedMcpServers'] : [];
	const others = denied.filter((entry) => !isRecord(entry) || entry['serverName'] !== name);
	const next = on ? others : [...others, { serverName: name }];
	const switched: JsonObject = { ...settings, deniedMcpServers: next };
	if (next.length === 0) delete switched['deniedMcpServers'];
	return switched;
}

export function turnedOffMcpServers(settings: JsonObject): string[] {
	const denied = settings['deniedMcpServers'];
	if (!Array.isArray(denied)) return [];
	return denied.flatMap((entry) =>
		isRecord(entry) && typeof entry['serverName'] === 'string' ? [entry['serverName']] : [],
	);
}

async function plainly<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (!(error instanceof SupervisorError) || error.kind !== 'protocol') throw error;
		throw new Error(error.detail.replace(/^[A-Z_]+: /u, ''), { cause: error });
	}
}

async function readTurnedOffMcpServers(settingsPath: string): Promise<string[]> {
	return turnedOffMcpServers(await readJsonObject(settingsPath));
}

async function resolveTarget(
	args: unknown,
	deps: McpServerDeps,
): Promise<{ supervisor: McpSupervisor; target: BridgeMcpServerTarget }> {
	const sessionId = field(args, 'sessionId');
	if (sessionId !== undefined) {
		if (typeof sessionId !== 'string' || sessionId.length === 0) {
			throw new Error('invalid args: `sessionId` must be a non-empty string');
		}
		return { supervisor: await deps.runtime.ensureSessionReady(sessionId), target: { sessionId } };
	}
	const cwd = await folder(optionalWorkstreamId(args), deps);
	return { supervisor: await deps.runtime.ensureReady(), target: { cwd } };
}

async function folder(workstreamId: string | null, deps: McpServerDeps): Promise<string> {
	return workstreamId === null ? homedir() : deps.resolveWorkstreamCheckout(workstreamId);
}

function optionalWorkstreamId(args: unknown): string | null {
	const value = field(args, 'workstreamId');
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error('invalid args: `workstreamId` must be a non-empty string or null');
	}
	return value;
}

function requireServerName(args: unknown): string {
	const value = field(args, 'serverName');
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error('invalid args: `serverName` must be a non-empty string');
	}
	if (value.length > MCP_SERVER_NAME_MAX_LENGTH) {
		throw new Error(
			`invalid args: \`serverName\` must be at most ${MCP_SERVER_NAME_MAX_LENGTH} characters`,
		);
	}
	return value;
}

function field(args: unknown, key: string): unknown {
	return isRecord(args) ? args[key] : undefined;
}
