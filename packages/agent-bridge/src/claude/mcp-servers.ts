import { setTimeout as delay } from 'node:timers/promises';
import {
	query as sdkQuery,
	type McpServerStatus,
	type Options,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { McpServerReport } from '../types.js';
import { idle } from './capabilities.js';
import { findClaudeExecutable } from './installation.js';
import { claudeEnvironment, type ClaudeQuery } from './session.js';

const LISTED_WITHIN_MS = 15_000;
const AUTHORIZATION_WINDOW_MS = 5 * 60_000;
const SETTLE_WINDOW_MS = 30_000;
const POLL_MS = 1_000;
const CONNECTOR_POLL_MS = 3_000;

export type McpProbeQuery = Pick<
	ClaudeQuery,
	'initializationResult' | 'mcpServerStatus' | 'reconnectMcpServer' | 'mcpAuthenticate' | 'close'
>;

export interface McpProbeOptions {
	readonly cwd: string;
	readonly executable: string;
	readonly env: Record<string, string>;
	readonly query: (params: {
		prompt: AsyncIterable<SDKUserMessage>;
		options: Options;
	}) => McpProbeQuery;
}

export interface McpAuthorization {
	readonly authUrl: string | null;
	readonly settled: Promise<McpServerReport | null>;
	readonly cancel: () => void;
}

export interface McpServerProbes {
	list(cwd: string): Promise<readonly McpServerReport[]>;
	authorize(cwd: string, serverName: string): Promise<McpAuthorization>;
	probe(cwd: string, serverName: string): Promise<McpServerReport | null>;
}

export type McpServerEntry = Pick<
	McpServerStatus,
	'name' | 'error' | 'source' | 'scope' | 'tools'
> & {
	readonly status: string;
};

export const claudeMcpServers: McpServerProbes = {
	list: async (cwd) => listMcpServers(claudeProbe(cwd)),
	authorize: async (cwd, serverName) => startMcpAuthorization(serverName, claudeProbe(cwd)),
	probe: async (cwd, serverName) => probeMcpServer(serverName, claudeProbe(cwd)),
};

function claudeProbe(cwd: string): McpProbeOptions {
	const executable = findClaudeExecutable();
	if (!executable) throw new Error('Claude Code is not installed');
	return { cwd, executable, env: claudeEnvironment(), query: sdkQuery };
}

export function mcpServerReport({
	name,
	status,
	error,
	source,
	scope,
	tools,
}: McpServerEntry): McpServerReport {
	const origin = source ?? scope;
	return {
		name,
		status,
		...(error ? { error } : {}),
		...(origin ? { source: origin } : {}),
		...(tools ? { toolCount: tools.length } : {}),
	};
}

export async function startMcpAuthorization(
	serverName: string,
	options: McpProbeOptions,
): Promise<McpAuthorization> {
	const probe = openProbe(options);
	try {
		await probe.query.initializationResult();
		if (!(await settle(probe.query, serverName, () => true, LISTED_WITHIN_MS))) {
			throw new Error(`Claude Code has no MCP server named ${serverName}`);
		}
		const authenticate = probe.query.mcpAuthenticate;
		if (!authenticate) {
			throw new Error('This Claude Code cannot authorize MCP servers. Update Claude Code first.');
		}
		const { authUrl, callbackExpected } = authentication(
			await authenticate.call(probe.query, serverName),
		);
		const cancelled = new AbortController();
		const settled = settle(
			probe.query,
			serverName,
			(server) => server.status === 'connected',
			authUrl ? AUTHORIZATION_WINDOW_MS : SETTLE_WINDOW_MS,
			authUrl !== null && !callbackExpected,
			cancelled.signal,
		).finally(probe.close);
		return { authUrl, settled, cancel: () => cancelled.abort() };
	} catch (error) {
		probe.close();
		throw error;
	}
}

export async function probeMcpServer(
	serverName: string,
	options: McpProbeOptions,
): Promise<McpServerReport | null> {
	const probe = openProbe(options);
	try {
		await probe.query.initializationResult();
		return await settle(
			probe.query,
			serverName,
			(server) => server.status !== 'pending',
			SETTLE_WINDOW_MS,
		);
	} finally {
		probe.close();
	}
}

export async function listMcpServers(options: McpProbeOptions): Promise<McpServerReport[]> {
	const probe = openProbe(options);
	try {
		await probe.query.initializationResult();
		const deadline = Date.now() + SETTLE_WINDOW_MS;
		for (;;) {
			const servers = await probe.query.mcpServerStatus();
			if (Date.now() >= deadline || servers.every(({ status }) => status !== 'pending')) {
				return servers.map((server) => mcpServerReport(server));
			}
			await delay(POLL_MS, undefined, { ref: false });
		}
	} finally {
		probe.close();
	}
}

function openProbe({ cwd, executable, env, query }: McpProbeOptions): {
	readonly query: McpProbeQuery;
	readonly close: () => void;
} {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const probe = query({
		prompt: idle(released),
		options: {
			cwd,
			abortController: new AbortController(),
			pathToClaudeCodeExecutable: executable,
			env,
			settingSources: ['user', 'project', 'local'],
			settings: { disableAllHooks: true },
			persistSession: false,
		},
	});
	return {
		query: probe,
		close: () => {
			release();
			probe.close();
		},
	};
}

async function settle(
	query: McpProbeQuery,
	serverName: string,
	done: (server: McpServerStatus) => boolean,
	windowMs: number,
	reconnect = false,
	cancelled?: AbortSignal,
): Promise<McpServerReport | null> {
	const deadline = Date.now() + windowMs;
	let seen: McpServerStatus | null = null;
	for (;;) {
		if (cancelled?.aborted) return null;
		if (reconnect) await query.reconnectMcpServer(serverName).catch(() => undefined);
		const servers = await query.mcpServerStatus().catch(() => []);
		const server = servers.find(({ name }) => name === serverName);
		if (server && done(server)) return mcpServerReport(server);
		seen = server ?? seen;
		if (Date.now() >= deadline) return seen && mcpServerReport(seen);
		await delay(reconnect ? CONNECTOR_POLL_MS : POLL_MS, undefined, {
			ref: false,
			...(cancelled ? { signal: cancelled } : {}),
		}).catch(() => undefined);
	}
}

function authentication(value: unknown): { authUrl: string | null; callbackExpected: boolean } {
	if (typeof value !== 'object' || value === null) {
		throw new Error('Claude Code answered the authorization without a result');
	}
	const authUrl = 'authUrl' in value && typeof value.authUrl === 'string' ? value.authUrl : null;
	if (authUrl !== null && !/^https?:/iu.test(authUrl)) {
		throw new Error('Claude Code answered with an authorization link that is not a web page');
	}
	return {
		authUrl,
		callbackExpected: 'callbackExpected' in value && value.callbackExpected === true,
	};
}
