import { readFile } from 'node:fs/promises';
import {
	createSdkMcpServer,
	tool,
	type Options,
	type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { BrowserRequest } from '../protocol.js';
import type { BrowserRequester } from '../providers/types.js';
import {
	PRE_APPROVED_PLATFORM_TOOLS,
	platformTools,
	type PlatformToolRequester,
} from './platform-tools.js';

export const MALINI_MCP_SERVER = 'malini';

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;

export function maliniTools(
	requestBrowser: BrowserRequester,
	requestPlatform: PlatformToolRequester,
): Required<Pick<Options, 'mcpServers' | 'allowedTools'>> {
	const run = (request: BrowserRequest): Promise<ToolResult> =>
		browserToolResult(requestBrowser, request);
	const browserTools = [
		tool(
			'browser_open',
			"Open a web page or a file from your worktree in Malini's browser, the one the user sees beside the chat, and wait for the page to load. A worktree file needs no server: pass its absolute path, a path starting with ./, or a file:// URL. A localhost URL waits up to 20s for a server that is still starting.",
			{
				url: z
					.string()
					.min(1)
					.describe('The page to open, for example http://localhost:5173 or ./docs/report.html'),
			},
			({ url }) => run({ action: 'open', url }),
		),
		tool(
			'browser_screenshot',
			"Capture the page open in Malini's browser. Returns the image and the path to embed in your report.",
			{},
			() => run({ action: 'screenshot' }),
		),
		tool(
			'browser_click',
			"Click the first element that matches a CSS selector in Malini's browser and wait for the page to settle.",
			{ selector: z.string().min(1).describe('A CSS selector, for example button[type=submit]') },
			({ selector }) => run({ action: 'click', selector }),
		),
		tool(
			'browser_type',
			"Replace the text in the first field that matches a CSS selector in Malini's browser, optionally pressing Enter after it.",
			{
				selector: z.string().min(1).describe('A CSS selector, for example input[name=email]'),
				text: z.string().describe('The text the field holds afterwards'),
				submit: z.boolean().default(false).describe('Press Enter after typing'),
			},
			({ selector, text, submit }) => run({ action: 'type', selector, text, submit }),
		),
		tool(
			'browser_back',
			"Go back one page in Malini's browser history and wait for the page to load.",
			{},
			() => run({ action: 'back' }),
		),
		tool(
			'browser_forward',
			"Go forward one page in Malini's browser history and wait for the page to load.",
			{},
			() => run({ action: 'forward' }),
		),
		tool(
			'browser_reload',
			"Reload the page open in Malini's browser and wait for it to load.",
			{},
			() => run({ action: 'reload' }),
		),
		tool(
			'browser_resize',
			"Make Malini's browser tab wider or narrower, for example when the page is too narrow for the layout you check. Malini moves the divider between the chat and the inspector the way the user drags it, and the width stays until the user drags it back. The chat and the inspector keep their minimum widths, so the result says how wide the page got. It works only while the user sees the tab.",
			{
				width: z
					.number()
					.int()
					.positive()
					.describe('The width the page should get, in CSS pixels, for example 1280'),
			},
			({ width }) => run({ action: 'resize', width }),
		),
	];
	const preApproved = [...browserTools.map(({ name }) => name), ...PRE_APPROVED_PLATFORM_TOOLS];
	return {
		mcpServers: {
			[MALINI_MCP_SERVER]: createSdkMcpServer({
				name: MALINI_MCP_SERVER,
				alwaysLoad: true,
				tools: [...browserTools, ...platformTools(requestPlatform)],
			}),
		},
		allowedTools: preApproved.map((name) => `mcp__${MALINI_MCP_SERVER}__${name}`),
	};
}

async function browserToolResult(
	requestBrowser: BrowserRequester,
	request: BrowserRequest,
): Promise<ToolResult> {
	try {
		const result = await requestBrowser(request);
		if (!result.ok) return failure(result.error ?? 'The browser could not do that.');
		const text = result.text ?? 'Done.';
		if (result.imagePath === undefined) return { content: [{ type: 'text', text }] };
		const data = await readFile(result.imagePath, 'base64');
		return {
			content: [
				{ type: 'text', text },
				{ type: 'image', data, mimeType: 'image/jpeg' },
			],
		};
	} catch (error) {
		return failure(error instanceof Error ? error.message : String(error));
	}
}

function failure(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}
