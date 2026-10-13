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

export const MALINI_MCP_SERVER = 'malini';

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;

export function maliniTools(
	requestBrowser: BrowserRequester,
): Required<Pick<Options, 'mcpServers' | 'allowedTools'>> {
	const run = (request: BrowserRequest): Promise<ToolResult> =>
		browserToolResult(requestBrowser, request);
	const tools = [
		tool(
			'browser_open',
			"Open a URL in malini's browser, the one the user sees beside the chat, and wait for the page to load.",
			{ url: z.string().min(1).describe('The page to open, for example http://localhost:5173') },
			({ url }) => run({ action: 'open', url }),
		),
		tool(
			'browser_screenshot',
			"Capture the page open in malini's browser. Returns the image and the path to embed in your report.",
			{},
			() => run({ action: 'screenshot' }),
		),
		tool(
			'browser_click',
			"Click the first element that matches a CSS selector in malini's browser and wait for the page to settle.",
			{ selector: z.string().min(1).describe('A CSS selector, for example button[type=submit]') },
			({ selector }) => run({ action: 'click', selector }),
		),
	];
	return {
		mcpServers: {
			[MALINI_MCP_SERVER]: createSdkMcpServer({ name: MALINI_MCP_SERVER, alwaysLoad: true, tools }),
		},
		allowedTools: tools.map(({ name }) => `mcp__${MALINI_MCP_SERVER}__${name}`),
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
