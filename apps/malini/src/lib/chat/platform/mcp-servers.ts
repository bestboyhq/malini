import { homedir } from 'node:os';
import { MCP_SERVER_NAME_MAX_LENGTH, type McpServerList } from '$contract/mcp-servers';
import { isRecord } from '$main/db/rows';
import type { CommandRegistry } from '$main/ipc/registry';
import { readJsonObject, updateClaudeSettings, type JsonObject } from '$lib/skills/skills.platform';
import type { BridgeMcpServerTarget } from './agent/protocol';
import type { BridgeRuntime } from './agent/runtime';
import { SupervisorError, type BridgeSupervisor } from './agent/supervisor';
import type { WorkstreamCheckoutResolver } from './attachments/commands';

export interface McpServerDeps {
	readonly runtime: Pick<BridgeRuntime, 'ensureReady' | 'ensureSessionReady'>;
	readonly claudeSettings: () => string;
	readonly resolveWorkstreamCheckout: WorkstreamCheckoutResolver;
}

export function defineMcpServerCommands(commands: CommandRegistry, deps: McpServerDeps): void {
	commands.define('chat.authorize-mcp-server', async (args: unknown) => {
		const serverName = requireServerName(args);
		const { supervisor, target } = await resolveTarget(args, deps);
		return { authUrl: await plainly(() => supervisor.authorizeMcpServer(target, serverName)) };
	});

	commands.define('chat.reconnect-mcp-server', async (args: unknown) => {
		const serverName = requireServerName(args);
		const { supervisor, target } = await resolveTarget(args, deps);
		await plainly(() => supervisor.reconnectMcpServer(target, serverName));
	});

	commands.define('chat.cancel-mcp-sign-in', async (args: unknown) => {
		const serverName = requireServerName(args);
		const supervisor = await deps.runtime.ensureReady();
		await plainly(() => supervisor.cancelMcpAuthorization(serverName));
	});

	commands.define('chat.list-mcp-servers', async (args: unknown): Promise<McpServerList> => {
		const cwd = await folder(optionalWorkstreamId(args), deps);
		const supervisor = await deps.runtime.ensureReady();
		const [servers, turnedOff] = await Promise.all([
			plainly(() => supervisor.listMcpServers(cwd)),
			readTurnedOffMcpServers(deps.claudeSettings()),
		]);
		return { servers, turnedOff };
	});

	commands.define('chat.turned-off-mcp-servers', () =>
		readTurnedOffMcpServers(deps.claudeSettings()),
	);

	commands.define('chat.switch-mcp-server', async (args: unknown) => {
		const serverName = requireServerName(args);
		const on = field(args, 'on');
		if (typeof on !== 'boolean') throw new Error('invalid args: `on` must be a boolean');
		const settings = await updateClaudeSettings(deps.claudeSettings(), (current) =>
			withMcpServerSwitched(current, serverName, on),
		);
		return turnedOffMcpServers(settings);
	});
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
): Promise<{ supervisor: BridgeSupervisor; target: BridgeMcpServerTarget }> {
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
