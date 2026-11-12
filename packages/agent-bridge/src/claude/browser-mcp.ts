import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import { MALINI_MCP_SERVER } from './browser-tools.js';

const CLAUDE_IN_CHROME = 'claude-in-chrome';
const BROWSER_LAUNCH =
	/playwright|puppeteer|selenium|stagehand|chrome-devtools-mcp|browserbase|browsermcp|browser-use|browserless|hyperbrowser|mcp-chrome|mcp-server-browser/iu;
const DEVICE = /(?:^|[^a-z])(?:ios|android|mobile|simulator|emulator|appium|device)/iu;
const BROWSER_TOOLS = [/navigat/iu, /click/iu, /screenshot|snapshot/iu];

export const BROWSER_TOOL_HINT =
	'Use the `browser_*` tools from the `malini` MCP server: `browser_open` opens a page in a tab the user sees, `browser_snapshot` reads it with refs, `browser_click`, `browser_type`, `browser_press`, `browser_hover`, `browser_scroll` and `browser_wait` act on it, `browser_evaluate` runs JavaScript, `browser_console` reads the console, `browser_upload` picks files for a file field, `browser_dialog` answers an alert or confirm dialog, `browser_resize` sets the viewport and `browser_screenshot` captures the page or one element.';

export const BROWSER_MCP_REFUSAL = `Malini hides browser MCP servers from its chats: Malini's own browser does the same work in a tab the user sees. ${BROWSER_TOOL_HINT}`;

type McpServer = Pick<McpServerStatus, 'name' | 'config' | 'source' | 'tools'>;

export function isBrowserMcpServer(server: McpServer): boolean {
	if (server.source === 'sdk' || server.name === MALINI_MCP_SERVER) return false;
	if (server.name === CLAUDE_IN_CHROME || BROWSER_LAUNCH.test(launchOf(server))) return true;
	const tools = (server.tools ?? []).map(({ name }) => name);
	return (
		!DEVICE.test([server.name, ...tools].join(' ')) &&
		BROWSER_TOOLS.every((kind) => tools.some((tool) => kind.test(tool)))
	);
}

export function mcpToolPrefix(serverName: string): string {
	return `mcp__${serverName.replace(/[^A-Za-z0-9_-]/gu, '_')}`;
}

function launchOf({ config }: McpServer): string {
	if (!config) return '';
	if ('command' in config) return [config.command, ...(config.args ?? [])].join(' ');
	return 'url' in config ? config.url : '';
}
