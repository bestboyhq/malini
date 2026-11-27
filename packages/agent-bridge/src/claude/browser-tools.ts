import { readFile } from 'node:fs/promises';
import {
	createSdkMcpServer,
	tool,
	type Options,
	type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { BrowserAction, BrowserRequest } from '../protocol.js';
import type { BrowserRequester } from '../providers/types.js';
import type { McpServerAdder } from './mcp-servers.js';
import {
	PRE_APPROVED_PLATFORM_TOOLS,
	platformTools,
	type PlatformToolRequester,
} from './platform-tools.js';

export const MALINI_MCP_SERVER = 'malini';

const TARGET =
	'A CSS selector such as button[type=submit], or a ref such as @e3 or @f1e3 from browser_snapshot';
const DEFAULT_WAIT_SECONDS = 10;
const MAX_WAIT_SECONDS = 30;
const MAX_PAGE_SIZE = 3_840;
const target = z.string().min(1);
const ALWAYS_LOAD = { alwaysLoad: true };
const profile = z
	.string()
	.min(1)
	.optional()
	.describe(
		'The browser profile to use, for example reddit-cats. Each profile keeps its own cookies and sign-ins in every chat, and each gets its own tab. Leave it out for the default profile.',
	);

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;

export function maliniTools(
	requestBrowser: BrowserRequester,
	requestPlatform: PlatformToolRequester,
	addMcpServer: McpServerAdder,
): Required<Pick<Options, 'mcpServers' | 'allowedTools'>> {
	const run = (request: BrowserAction, profile: string | undefined): Promise<ToolResult> =>
		browserToolResult(requestBrowser, profile === undefined ? request : { ...request, profile });
	const browserTools = [
		tool(
			'browser_open',
			"Open a web page or a file from your worktree in Malini's browser, the one the user sees beside the chat, and wait for the page to load. A worktree file needs no server: pass its absolute path, a path starting with ./, or a file:// URL. A localhost URL waits up to 20s for a server that is still starting. To show several accounts of one site side by side, open the page once per profile.",
			{
				url: z
					.string()
					.min(1)
					.describe('The page to open, for example http://localhost:5173 or ./docs/report.html'),
				profile,
			},
			({ url, profile }) => run({ action: 'open', url }, profile),
			ALWAYS_LOAD,
		),
		tool(
			'browser_snapshot',
			"Read the page open in Malini's browser as text: its headings, text, images and every control you can click or type into, each control with a ref such as @e3 that the other browser tools take as their selector. It reads into iframes too, and a control inside one gets a ref such as @f1e3. It is faster than a screenshot when you need what the page says or which element to act on. Take a new snapshot once the page changes: the refs of an older one stop working.",
			{ profile },
			({ profile }) => run({ action: 'snapshot' }, profile),
			ALWAYS_LOAD,
		),
		tool(
			'browser_screenshot',
			"Capture the page open in Malini's browser: what the tab shows, one element, or the whole page beyond what the tab shows. Returns the image and the path to embed in your report.",
			{
				selector: target.optional().describe(`Capture only this element. ${TARGET}`),
				fullPage: z
					.boolean()
					.default(false)
					.describe('Capture the whole page, not only the part the tab shows'),
				profile,
			},
			({ selector, fullPage, profile }) =>
				run(
					{ action: 'screenshot', fullPage, ...(selector === undefined ? {} : { selector }) },
					profile,
				),
			ALWAYS_LOAD,
		),
		tool(
			'browser_click',
			"Click an element in Malini's browser with the mouse and wait for the page to settle. Malini waits up to 5s for the element to show, scrolls it into view, and refuses when another element covers it, naming that element.",
			{ selector: target.describe(TARGET), profile },
			({ selector, profile }) => run({ action: 'click', selector }, profile),
			ALWAYS_LOAD,
		),
		tool(
			'browser_hover',
			"Move the mouse over an element in Malini's browser, for example to open a menu or check a hover state. Malini scrolls it into view first.",
			{ selector: target.describe(TARGET), profile },
			({ selector, profile }) => run({ action: 'hover', selector }, profile),
		),
		tool(
			'browser_type',
			"Replace the text in a field in Malini's browser, or pick the option of a select whose label or value is the text, optionally pressing Enter after it.",
			{
				selector: target.describe(TARGET),
				text: z.string().describe('The text the field holds afterwards'),
				submit: z.boolean().default(false).describe('Press Enter after typing'),
				profile,
			},
			({ selector, text, submit, profile }) =>
				run({ action: 'type', selector, text, submit }, profile),
			ALWAYS_LOAD,
		),
		tool(
			'browser_press',
			"Press a key or a key combination in Malini's browser, on the element that has focus, and wait for the page to settle. To drive a game that reads held keys, click the game first, then hold the key for some seconds.",
			{
				key: z
					.string()
					.min(1)
					.describe(
						'A key name or a single character, with modifiers joined by +, for example Escape, Enter, Tab, Shift+Tab, ArrowDown, Meta+K or a',
					),
				holdSeconds: z
					.number()
					.min(0)
					.max(MAX_WAIT_SECONDS)
					.default(0)
					.describe('How long to hold the key down before releasing it, for example 2'),
				profile,
			},
			({ key, holdSeconds, profile }) => run({ action: 'press', key, holdSeconds }, profile),
			ALWAYS_LOAD,
		),
		tool(
			'browser_scroll',
			"Scroll Malini's browser with the mouse wheel, over an element or over the middle of the page. With only a selector, it scrolls that element into view. Returns where the page is scrolled to.",
			{
				y: z.number().int().default(0).describe('Pixels to scroll down; negative scrolls up'),
				x: z.number().int().default(0).describe('Pixels to scroll right; negative scrolls left'),
				selector: target.optional().describe(`Scroll over this element. ${TARGET}`),
				profile,
			},
			({ x, y, selector, profile }) =>
				run({ action: 'scroll', x, y, ...(selector === undefined ? {} : { selector }) }, profile),
		),
		tool(
			'browser_wait',
			"Wait until text or an element shows in Malini's browser, or until it is gone. With neither, wait that many seconds, for example for an animation to end.",
			{
				text: z.string().min(1).optional().describe('Text the page shows'),
				selector: target.optional().describe(`An element on the page. ${TARGET}`),
				gone: z.boolean().default(false).describe('Wait until the text or element is gone instead'),
				seconds: z
					.number()
					.positive()
					.max(MAX_WAIT_SECONDS)
					.default(DEFAULT_WAIT_SECONDS)
					.describe('How long to wait at most'),
				profile,
			},
			({ text, selector, gone, seconds, profile }) =>
				run(
					{
						action: 'wait',
						seconds,
						gone,
						...(text === undefined ? {} : { text }),
						...(selector === undefined ? {} : { selector }),
					},
					profile,
				),
			ALWAYS_LOAD,
		),
		tool(
			'browser_evaluate',
			"Run JavaScript in the page open in Malini's browser the way its DevTools console does, and return the result: a string as it is, anything else as JSON. Use it to measure elements, read app state or check styles. Promises are awaited.",
			{
				script: z
					.string()
					.min(1)
					.describe(
						'Statements or an expression such as document.title, a function such as () => [...document.links].length, or a function body that ends with return. await works anywhere',
					),
				profile,
			},
			({ script, profile }) => run({ action: 'evaluate', script }, profile),
			ALWAYS_LOAD,
		),
		tool(
			'browser_console',
			"Read the console messages and uncaught errors of the page open in Malini's browser since it loaded, newest last.",
			{ profile },
			({ profile }) => run({ action: 'console' }, profile),
			ALWAYS_LOAD,
		),
		tool(
			'browser_back',
			"Go back one page in Malini's browser history and wait for the page to load.",
			{ profile },
			({ profile }) => run({ action: 'back' }, profile),
		),
		tool(
			'browser_forward',
			"Go forward one page in Malini's browser history and wait for the page to load.",
			{ profile },
			({ profile }) => run({ action: 'forward' }, profile),
		),
		tool(
			'browser_reload',
			"Reload the page open in Malini's browser and wait for it to load.",
			{ profile },
			({ profile }) => run({ action: 'reload' }, profile),
			ALWAYS_LOAD,
		),
		tool(
			'browser_resize',
			"Make the page in Malini's browser wider or narrower, for example to check a layout at another width. While the user sees the tab, Malini moves the divider between the chat and the inspector the way the user drags it, the width stays until the user drags it back, and the chat and the inspector keep their minimum widths, so the result says how wide the page got. While the user does not see it, the page gets the width and height you ask for.",
			{
				width: z
					.number()
					.int()
					.positive()
					.max(MAX_PAGE_SIZE)
					.describe('The width the page should get, in CSS pixels, for example 1280'),
				height: z
					.number()
					.int()
					.positive()
					.max(MAX_PAGE_SIZE)
					.optional()
					.describe(
						'The height the page should get, in CSS pixels, while the user does not see the tab',
					),
				profile,
			},
			({ width, height, profile }) =>
				run({ action: 'resize', width, ...(height === undefined ? {} : { height }) }, profile),
			ALWAYS_LOAD,
		),
		tool(
			'browser_upload',
			"Pick files for a file field in Malini's browser, the way a person picks them in the file chooser. The selector is the file input or the button that opens a file chooser. Malini never shows the chooser itself, so use this tool instead of clicking such a button.",
			{
				selector: target.describe(TARGET),
				paths: z
					.array(z.string().min(1))
					.min(1)
					.describe(
						'The files to pick, each a path in your worktree, for example ./fixtures/photo.png. Copy a file from elsewhere into the worktree first, for example under .context/',
					),
				profile,
			},
			({ selector, paths, profile }) => run({ action: 'upload', selector, paths }, profile),
		),
		tool(
			'browser_dialog',
			"Answer the alert or confirm dialog the page in Malini's browser waits on. A browser tool that opens one returns its message, and the other browser tools wait until you answer it.",
			{
				accept: z
					.boolean()
					.describe(
						'Press OK, or Cancel when false. An alert has only OK, so it closes either way',
					),
				profile,
			},
			({ accept, profile }) => run({ action: 'dialog', accept }, profile),
		),
		tool(
			'browser_close',
			"Close the tab you opened in Malini's browser, its page included, once the user no longer needs to see it. Tabs the user opened stay. browser_open opens a new tab again.",
			{ profile },
			({ profile }) => run({ action: 'close' }, profile),
			ALWAYS_LOAD,
		),
	];
	const preApproved = [...browserTools.map(({ name }) => name), ...PRE_APPROVED_PLATFORM_TOOLS];
	return {
		mcpServers: {
			[MALINI_MCP_SERVER]: createSdkMcpServer({
				name: MALINI_MCP_SERVER,
				tools: [...browserTools, ...platformTools(requestPlatform, addMcpServer)],
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
