import { describe, expect, it } from 'vitest';
import {
	groupMcpServers,
	mcpFixSteps,
	mcpServer,
	nextFixStep,
	sharesDisplayName,
	withTurnedOffListed,
	type McpFixStep,
} from './mcp-server';

const servers = [
	mcpServer({ name: 'plugin:productivity:slack', status: 'needs-auth', source: 'plugin' }),
	mcpServer({ name: 'claude.ai Gmail', status: 'failed', source: 'claudeai', error: 'expired' }),
	mcpServer({ name: 'plugin:productivity:gmail', status: 'failed', source: 'plugin' }),
	mcpServer({ name: 'claude.ai Google Calendar', status: 'connected', source: 'claudeai' }),
	mcpServer({ name: 'plugin:productivity:google-calendar', status: 'needs-auth' }),
	mcpServer({ name: 'plugin:github:github', status: 'failed', error: 'bad header' }),
	mcpServer({ name: 'codebase-memory-mcp', status: 'connected', source: 'user', toolCount: 14 }),
	mcpServer({ name: 'context7', status: 'pending', source: 'user' }),
];

describe('MCP server triage', () => {
	it('groups every server by what fixes it, and a failing copy of a connected service as a duplicate', () => {
		const groups = groupMcpServers(servers, ['plugin:github:github']);
		const names = (list: readonly { name: string }[]): string[] => list.map(({ name }) => name);

		expect(names(groups.signIn)).toEqual(['plugin:productivity:slack']);
		expect(names(groups.claudeAi)).toEqual(['claude.ai Gmail']);
		expect(names(groups.failed)).toEqual(['plugin:productivity:gmail']);
		expect(names(groups.duplicates)).toEqual(['plugin:productivity:google-calendar']);
		expect(names(groups.connecting)).toEqual(['context7']);
		expect(names(groups.ready)).toEqual(['claude.ai Google Calendar', 'codebase-memory-mcp']);
		expect(names(groups.off)).toEqual(['plugin:github:github']);
	});

	it('tags a server with its origin only when another server shares its name', () => {
		const gmail = servers[1];
		const slack = servers[0];
		if (!gmail || !slack) throw new Error('fixture missing');
		expect(gmail.origin).toEqual({ kind: 'claude-ai' });
		expect(servers[2]?.origin).toEqual({ kind: 'plugin', plugin: 'productivity' });
		expect(sharesDisplayName(gmail, servers)).toBe(true);
		expect(sharesDisplayName(slack, servers)).toBe(false);
	});

	it('lists a server turned off in the settings even when Claude Code hides it', () => {
		const listed = withTurnedOffListed(servers.slice(0, 1), ['figma']);
		expect(listed.map(({ name, status }) => [name, status])).toEqual([
			['plugin:productivity:slack', 'needs-auth'],
			['figma', 'disabled'],
		]);
	});

	it('walks sign-ins first, then claude.ai connectors, then failures, skipping finished steps', () => {
		const steps = mcpFixSteps(groupMcpServers(servers, []));
		expect(steps.map(({ server, fix }) => [server.name, fix])).toEqual([
			['plugin:productivity:slack', 'sign-in'],
			['claude.ai Gmail', 'reconnect-on-claude-ai'],
			['plugin:productivity:gmail', 'retry'],
			['plugin:github:github', 'retry'],
		]);
		const walked: McpFixStep[] = steps.map((step, index) =>
			index === 1 ? { ...step, outcome: 'fixed' } : step,
		);
		expect(nextFixStep(walked, 0)).toBe(2);
		expect(nextFixStep(walked, 3)).toBe(4);
	});
});
