import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { initializeResponse } from './fixtures/fake-claude.js';
import { startMcpAuthorization, type McpProbeOptions } from './mcp-servers.js';

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
});
