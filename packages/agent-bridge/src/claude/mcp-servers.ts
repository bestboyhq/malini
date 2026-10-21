import { setTimeout as delay } from 'node:timers/promises';
import type { McpServerStatus, Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { idle } from './capabilities.js';
import type { ClaudeQuery } from './session.js';

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
	readonly settled: Promise<McpServerStatus | null>;
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
		const settled = settle(
			probe.query,
			serverName,
			(server) => server.status === 'connected',
			authUrl ? AUTHORIZATION_WINDOW_MS : SETTLE_WINDOW_MS,
			authUrl !== null && !callbackExpected,
		).finally(probe.close);
		return { authUrl, settled };
	} catch (error) {
		probe.close();
		throw error;
	}
}

export async function probeMcpServer(
	serverName: string,
	options: McpProbeOptions,
): Promise<McpServerStatus | null> {
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
): Promise<McpServerStatus | null> {
	const deadline = Date.now() + windowMs;
	for (;;) {
		if (reconnect) await query.reconnectMcpServer(serverName).catch(() => undefined);
		const servers = await query.mcpServerStatus().catch(() => []);
		const server = servers.find(({ name }) => name === serverName);
		if (server && done(server)) return server;
		if (Date.now() >= deadline) return null;
		await delay(reconnect ? CONNECTOR_POLL_MS : POLL_MS, undefined, { ref: false });
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
