import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerListing } from '../types.js';
import { initializeResponse } from './fixtures/fake-claude.js';
import {
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
			executable: 'claude',
			env: {},
			query,
		});
		cancel();

		await expect(settled).resolves.toBeNull();
		expect(closed).toBe(true);
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
			{ cwd: '/repo', executable: 'claude', env: {}, query },
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
			{ cwd: '/repo', executable: 'claude', env: {}, query },
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
		return { options: { cwd: '/work/one', executable: 'claude', env: {}, query }, toggled };
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
