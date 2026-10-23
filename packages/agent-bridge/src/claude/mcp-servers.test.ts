import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { initializeResponse } from './fixtures/fake-claude.js';
import { listMcpServers, startMcpAuthorization, type McpProbeOptions } from './mcp-servers.js';

describe('startMcpAuthorization', () => {
	it('hands back the link and keeps Claude Code open until the server connects', async () => {
		let status: McpServerStatus['status'] = 'needs-auth';
		let closed = false;
		const query: McpProbeOptions['query'] = () => ({
			initializationResult: async () => initializeResponse([]),
			mcpServerStatus: async () => [{ name: 'linear', status }],
			reconnectMcpServer: async () => undefined,
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

describe('listMcpServers', () => {
	it('lists every server once none is pending, with where it comes from and its tools', async () => {
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
			close: () => {
				closed = true;
			},
		});

		const servers = await listMcpServers({ cwd: '/repo', executable: 'claude', env: {}, query });

		expect(servers).toEqual([
			{ name: 'plugin:svelte:svelte', status: 'connected', source: 'plugin', toolCount: 2 },
			{ name: 'linear', status: 'needs-auth', source: 'user' },
			{ name: 'sentry', status: 'failed', error: 'connection refused' },
		]);
		expect(polls).toBe(2);
		expect(closed).toBe(true);
	});
});
