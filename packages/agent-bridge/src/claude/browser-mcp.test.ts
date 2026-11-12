import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { isBrowserMcpServer, mcpToolPrefix } from './browser-mcp.js';

function server(
	name: string,
	launch: string | null,
	tools: readonly string[] = [],
): McpServerStatus {
	const [command = '', ...args] = launch?.split(' ') ?? [];
	return {
		name,
		status: 'connected',
		source: 'user',
		...(launch === null
			? {}
			: launch.startsWith('https://')
				? { config: { type: 'http', url: launch } }
				: { config: { type: 'stdio', command, args } }),
		tools: tools.map((tool) => ({ name: tool })),
	};
}

describe('isBrowserMcpServer', () => {
	it('finds a browser server by what it launches, whatever the user named it', () => {
		for (const browser of [
			server('web', 'npx @playwright/mcp@latest --headless'),
			server('devtools', 'npx -y chrome-devtools-mcp@latest'),
			server('pptr', 'npx -y @modelcontextprotocol/server-puppeteer'),
			server('bb', 'https://mcp.browserbase.com/mcp'),
			server('docker-pw', 'docker run -i --rm mcp/playwright'),
			server('claude-in-chrome', null),
		]) {
			expect(isBrowserMcpServer(browser)).toBe(true);
		}
	});

	it('finds a wrapped browser server by its tools', () => {
		expect(
			isBrowserMcpServer(
				server('qa', 'node ./tools/qa-server.js', ['navigate_page', 'click', 'take_snapshot']),
			),
		).toBe(true);
	});

	it('leaves simulators, other servers and Malini alone', () => {
		for (const other of [
			server('ios', 'npx -y ios-simulator-mcp', ['ui_tap', 'screenshot', 'launch_app']),
			server('mobile', 'npx -y @mobilenext/mobile-mcp@latest', [
				'mobile_navigate_back',
				'mobile_click_on_screen_at_coordinates',
				'mobile_take_screenshot',
			]),
			server('github', 'https://api.githubcopilot.com/mcp/', ['create_issue']),
			server('svelte', 'npx -y @sveltejs/mcp', ['get-documentation']),
			{ ...server('malini', null, ['browser_navigate', 'browser_click']), source: 'sdk' as const },
		]) {
			expect(isBrowserMcpServer(other)).toBe(false);
		}
	});
});

describe('mcpToolPrefix', () => {
	it('names tools the way Claude Code does', () => {
		expect(mcpToolPrefix('claude-in-chrome')).toBe('mcp__claude-in-chrome');
		expect(mcpToolPrefix('my browser.v2')).toBe('mcp__my_browser_v2');
	});
});
