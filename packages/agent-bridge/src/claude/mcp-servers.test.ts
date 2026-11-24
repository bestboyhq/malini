import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServerStatus, Options } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerListing } from '../types.js';
import { initializeResponse } from './fixtures/fake-claude.js';
import {
	mcpToolCaller,
	probeMcpServer,
	startMcpAuthorization,
	switchMcpServerLive,
	turnOnMcpServer,
	watchMcpServers,
	type McpProbeOptions,
} from './mcp-servers.js';

beforeEach(() => {
	vi.stubEnv('CLAUDE_CONFIG_DIR', mkdtempSync(join(tmpdir(), 'malini-mcp-')));
});

describe('startMcpAuthorization', () => {
	it('hands back the link and keeps Claude Code open until the server connects', async () => {
		let status: McpServerStatus['status'] = 'needs-auth';
		let closed = false;
		const query: McpProbeOptions['query'] = () => ({
			initializationResult: async () => initializeResponse([]),
			mcpServerStatus: async () => [{ name: 'linear', status }],
			reconnectMcpServer: async () => undefined,
			toggleMcpServer: async () => undefined,
			applyFlagSettings: async () => undefined,
			mcpAuthenticate: async () => {
				status = 'connected';
				return {
					authUrl: 'https://linear.app/oauth',
					requiresUserAction: true,
					callbackExpected: true,
				};
			},
			close: () => {
				closed = true;
			},
		});

		const { authUrl, settled } = await startMcpAuthorization('linear', {
			cwd: '/repo',
			plugins: [],
			executable: 'claude',
			env: {},
			query,
		});

		expect(authUrl).toBe('https://linear.app/oauth');
		await expect(settled).resolves.toEqual({ name: 'linear', status: 'connected' });
		expect(closed).toBe(true);
	});

	it('closes Claude Code at once when the sign-in is cancelled', async () => {
		let closed = false;
		const query: McpProbeOptions['query'] = () => ({
			initializationResult: async () => initializeResponse([]),
			mcpServerStatus: async () => [{ name: 'linear', status: 'needs-auth' }],
			reconnectMcpServer: async () => undefined,
			toggleMcpServer: async () => undefined,
			applyFlagSettings: async () => undefined,
			mcpAuthenticate: async () => ({
				authUrl: 'https://linear.app/oauth',
				callbackExpected: true,
			}),
			close: () => {
				closed = true;
			},
		});

		const { settled, cancel } = await startMcpAuthorization('linear', {
			cwd: '/repo',
			plugins: [],
			executable: 'claude',
			env: {},
			query,
		});
		cancel();

		await expect(settled).resolves.toBeNull();
		expect(closed).toBe(true);
	});
});

describe('probeMcpServer', () => {
	it('opens Claude Code with the plugin folders of the extensions, so it reports their servers', async () => {
		const opened: Options[] = [];
		const query: McpProbeOptions['query'] = ({ options }) => {
			opened.push(options);
			return {
				initializationResult: async () => initializeResponse([]),
				mcpServerStatus: async () => [{ name: 'plugin:linear:linear', status: 'needs-auth' }],
				reconnectMcpServer: async () => undefined,
				toggleMcpServer: async () => undefined,
				applyFlagSettings: async () => undefined,
				close: () => undefined,
			};
		};

		const server = await probeMcpServer('plugin:linear:linear', {
			cwd: '/repo',
			plugins: ['/extensions/linear'],
			executable: 'claude',
			env: {},
			query,
		});

		expect(server).toEqual({ name: 'plugin:linear:linear', status: 'needs-auth' });
		expect(opened.map(({ plugins }) => plugins)).toEqual([
			[{ type: 'local', path: '/extensions/linear' }],
		]);
	});
});

describe('watchMcpServers', () => {
	it('reports every change while servers connect, then holds the open Claude Code', async () => {
		let polls = 0;
		let closed = false;
		const query: McpProbeOptions['query'] = () => ({
			initializationResult: async () => initializeResponse([]),
			mcpServerStatus: async (): Promise<McpServerStatus[]> => [
				{
					name: 'plugin:svelte:svelte',
					status: ++polls < 2 ? 'pending' : 'connected',
					source: 'plugin',
					scope: 'dynamic',
					...(polls < 2
						? {}
						: { tools: [{ name: 'get-documentation' }, { name: 'list-sections' }] }),
				},
				{ name: 'linear', status: 'needs-auth', scope: 'user' },
				{ name: 'sentry', status: 'failed', error: 'connection refused' },
			],
			reconnectMcpServer: async () => undefined,
			toggleMcpServer: async () => undefined,
			applyFlagSettings: async () => undefined,
			close: () => {
				closed = true;
			},
		});
		const listings: McpServerListing[] = [];

		const watch = watchMcpServers(
			{ cwd: '/repo', plugins: [], executable: 'claude', env: {}, query },
			(listing) => listings.push(listing),
		);
		await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(3), { timeout: 3_000 });

		expect(listings).toEqual([
			{
				servers: [
					{ name: 'plugin:svelte:svelte', status: 'pending', source: 'plugin' },
					{ name: 'linear', status: 'needs-auth', source: 'user' },
					{ name: 'sentry', status: 'failed', error: 'connection refused' },
				],
				settled: false,
			},
			{
				servers: [
					{ name: 'plugin:svelte:svelte', status: 'connected', source: 'plugin', toolCount: 2 },
					{ name: 'linear', status: 'needs-auth', source: 'user' },
					{ name: 'sentry', status: 'failed', error: 'connection refused' },
				],
				settled: true,
			},
		]);
		expect(watch.current()).toEqual(listings[1]);
		expect(closed).toBe(false);
		watch.close();
		expect(closed).toBe(true);
	});

	it('turns a server on in its open Claude Code and reports it at once', async () => {
		let on = false;
		const query: McpProbeOptions['query'] = () => ({
			initializationResult: async () => initializeResponse([]),
			mcpServerStatus: async (): Promise<McpServerStatus[]> =>
				on ? [{ name: 'linear', status: 'connected', scope: 'user' }] : [],
			reconnectMcpServer: async () => undefined,
			toggleMcpServer: async (_name, enabled) => {
				on = enabled;
			},
			applyFlagSettings: async () => undefined,
			close: () => undefined,
		});
		const listings: McpServerListing[] = [];
		const watch = watchMcpServers(
			{ cwd: '/repo', plugins: [], executable: 'claude', env: {}, query },
			(listing) => listings.push(listing),
		);

		await expect(watch.turnOn('linear')).resolves.toBe(true);

		expect(listings.at(-1)).toEqual({
			servers: [{ name: 'linear', status: 'connected', source: 'user' }],
			settled: true,
		});
		watch.close();
	});
});

describe('switchMcpServerLive', () => {
	it('has Claude Code read its settings again, then keeps turning a server on until they allow it', async () => {
		const calls: string[] = [];
		const toggled = await switchMcpServerLive(
			{
				applyFlagSettings: async (settings) => {
					calls.push(`flags ${JSON.stringify(settings)}`);
				},
				toggleMcpServer: async () => {
					calls.push('toggle');
					if (calls.length < 4) {
						throw new Error('MCP server linear is blocked by enterprise managed policy');
					}
				},
			},
			'linear',
			true,
		);

		expect(toggled).toBe(true);
		expect(calls).toEqual(['flags {}', 'toggle', 'toggle', 'toggle']);
	});

	it('gives up at once when the Claude Code has no server to turn off', async () => {
		let attempts = 0;
		const toggled = await switchMcpServerLive(
			{
				applyFlagSettings: async () => undefined,
				toggleMcpServer: async () => {
					attempts += 1;
					throw new Error('MCP server linear not found');
				},
			},
			'linear',
			false,
		);

		expect(toggled).toBe(false);
		expect(attempts).toBe(1);
	});
});

describe('turnOnMcpServer', () => {
	function folderWith(status: McpServerStatus['status']): {
		readonly options: McpProbeOptions;
		readonly toggled: string[];
	} {
		const toggled: string[] = [];
		let current = status;
		const query: McpProbeOptions['query'] = () => ({
			initializationResult: async () => initializeResponse([]),
			mcpServerStatus: async (): Promise<McpServerStatus[]> => [
				{ name: 'linear', status: current },
			],
			reconnectMcpServer: async () => undefined,
			toggleMcpServer: async (name, enabled) => {
				toggled.push(`${name} ${enabled ? 'on' : 'off'}`);
				current = 'connected';
			},
			applyFlagSettings: async () => undefined,
			close: () => undefined,
		});
		return {
			options: { cwd: '/work/one', plugins: [], executable: 'claude', env: {}, query },
			toggled,
		};
	}

	it('turns a server back on where an earlier live switch left it off', async () => {
		const { options, toggled } = folderWith('disabled');

		await expect(turnOnMcpServer('linear', options)).resolves.toBe(true);

		expect(toggled).toEqual(['linear on']);
	});

	it('leaves a folder alone when the server is not off there', async () => {
		const { options, toggled } = folderWith('needs-auth');

		await expect(turnOnMcpServer('linear', options)).resolves.toBe(true);

		expect(toggled).toEqual([]);
	});
});

describe('mcpToolCaller', () => {
	const TOOLS = [
		{ name: 'describe', annotations: { readOnly: true } },
		{ name: 'create_insight', annotations: { readOnly: false } },
		{ name: 'trend' },
	];

	function claude(
		servers: () => McpServerStatus[],
		answer: (args: Record<string, unknown>) => Promise<unknown> = async () => ({
			subtype: 'success',
			response: { content: [{ type: 'text', text: 'hello' }] },
		}),
	) {
		const opened: string[] = [];
		const requests: unknown[] = [];
		let closed = 0;
		const query: McpProbeOptions['query'] = ({ options }) => {
			opened.push(`${options.cwd} [${options.plugins?.map(({ path }) => path).join() ?? ''}]`);
			return {
				initializationResult: async () => initializeResponse([]),
				mcpServerStatus: async () => servers(),
				reconnectMcpServer: async () => undefined,
				toggleMcpServer: async () => undefined,
				applyFlagSettings: async () => undefined,
				request: async (payload) => {
					requests.push(payload);
					const args = payload['arguments'];
					return answer(typeof args === 'object' && args !== null ? { ...args } : {});
				},
				close: () => {
					closed += 1;
				},
			};
		};
		const options = (cwd = '/repo', plugins: string[] = []): McpProbeOptions => ({
			cwd,
			plugins,
			executable: 'claude',
			env: {},
			query,
		});
		return { options, opened, requests, closed: () => closed };
	}

	it('tells a missing server from one that waits for sign-in, is off, or failed', async () => {
		const { options, requests } = claude(() => [
			{ name: 'linear', status: 'needs-auth' },
			{ name: 'sentry', status: 'disabled' },
			{ name: 'grip', status: 'failed', error: 'connection refused' },
		]);
		const call = mcpToolCaller();

		expect(await call(options(), 'gone', 'describe', {})).toEqual({ kind: 'missing' });
		expect(await call(options(), 'linear', 'describe', {})).toEqual({ kind: 'needs-auth' });
		expect(await call(options(), 'sentry', 'describe', {})).toEqual({ kind: 'off' });
		expect(await call(options(), 'grip', 'describe', {})).toEqual({
			kind: 'failed',
			error: 'connection refused',
		});
		expect(requests).toEqual([]);
	});

	it('runs only a tool the server lists as read-only', async () => {
		const { options, requests } = claude(() => [
			{ name: 'logdash', status: 'connected', tools: TOOLS },
		]);
		const call = mcpToolCaller();

		expect(await call(options(), 'logdash', 'overview', {})).toEqual({ kind: 'no-tool' });
		expect(await call(options(), 'logdash', 'create_insight', {})).toEqual({
			kind: 'not-read-only',
		});
		expect(await call(options(), 'logdash', 'trend', {})).toEqual({ kind: 'not-read-only' });
		expect(requests).toEqual([]);
	});

	it('waits for a connecting server, then calls the tool by its normalized name and joins its text', async () => {
		let reads = 0;
		const { options, requests } = claude(
			() => [
				{ name: 'claude.ai Logdash', status: ++reads < 2 ? 'pending' : 'connected', tools: TOOLS },
			],
			async () => ({
				subtype: 'success',
				response: {
					content: [
						{ type: 'text', text: 'visits 3' },
						{ type: 'image', data: 'AAAA', mimeType: 'image/png' },
						{ type: 'text', text: 'pageviews 9' },
					],
				},
			}),
		);

		expect(await mcpToolCaller()(options(), 'claude.ai Logdash', 'describe', { days: 7 })).toEqual({
			kind: 'output',
			text: 'visits 3\npageviews 9',
		});
		expect(requests).toEqual([
			{ subtype: 'mcp_call', tool: 'mcp__claude_ai_Logdash__describe', arguments: { days: 7 } },
		]);
	});

	it('answers with the structured content, and fails on a tool error or an answer over 256 KB', async () => {
		const { options } = claude(
			() => [{ name: 'logdash', status: 'connected', tools: TOOLS }],
			async ({ answer }) => ({
				subtype: 'success',
				response:
					answer === 'structured'
						? { content: [{ type: 'text', text: '{}' }], structuredContent: { visits: 3 } }
						: answer === 'error'
							? { isError: true, content: [{ type: 'text', text: '  quota exceeded \n' }] }
							: { content: [{ type: 'text', text: 'x'.repeat(256 * 1_024 + 1) }] },
			}),
		);
		const call = mcpToolCaller();

		expect(await call(options(), 'logdash', 'describe', { answer: 'structured' })).toEqual({
			kind: 'output',
			text: '{"visits":3}',
		});
		expect(await call(options(), 'logdash', 'describe', { answer: 'error' })).toEqual({
			kind: 'failed',
			error: 'quota exceeded',
		});
		expect(await call(options(), 'logdash', 'describe', { answer: 'huge' })).toEqual({
			kind: 'failed',
			error: 'The tool answered with more than 256 KB',
		});
	});

	it('keeps one Claude Code per folder and plugins, and opens a new one after a failure or a config change', async () => {
		const { options, opened, closed } = claude(
			() => [{ name: 'logdash', status: 'connected', tools: TOOLS }],
			async ({ fail }) => {
				if (fail) throw new Error(`  MCP server not connected: logdash ${'.'.repeat(400)}`);
				return { subtype: 'success', response: { content: [{ type: 'text', text: 'ok' }] } };
			},
		);
		const call = mcpToolCaller();

		await call(options(), 'logdash', 'describe', {});
		await call(options(), 'logdash', 'describe', {});
		await call(options('/repo', ['/extensions/logdash']), 'logdash', 'describe', {});
		expect(opened).toEqual(['/repo []', '/repo [/extensions/logdash]']);
		expect(closed()).toBe(0);

		const failed = await call(options(), 'logdash', 'describe', { fail: true });
		expect(failed).toMatchObject({ kind: 'failed' });
		expect(failed.kind === 'failed' && failed.error).toMatch(
			/^MCP server not connected: logdash \.+$/u,
		);
		expect(failed.kind === 'failed' && failed.error.length).toBe(300);
		expect(closed()).toBe(1);
		await call(options(), 'logdash', 'describe', {});
		expect(opened).toHaveLength(3);

		writeFileSync(join(process.env['CLAUDE_CONFIG_DIR'] ?? '', 'settings.json'), '{}');
		await call(options(), 'logdash', 'describe', {});
		expect(opened).toHaveLength(4);
		expect(closed()).toBe(2);
	});

	it('fails with a clear message when Claude Code cannot call MCP tools', async () => {
		const { options } = claude(() => [{ name: 'logdash', status: 'connected', tools: TOOLS }]);
		const withoutRequest = ({ ...rest }: McpProbeOptions): McpProbeOptions => ({
			...rest,
			query: (params) => {
				const { request: _request, ...query } = rest.query(params);
				return query;
			},
		});

		expect(await mcpToolCaller()(withoutRequest(options()), 'logdash', 'describe', {})).toEqual({
			kind: 'failed',
			error: 'This Claude Code cannot call MCP tools. Update Claude Code first.',
		});
	});
});
