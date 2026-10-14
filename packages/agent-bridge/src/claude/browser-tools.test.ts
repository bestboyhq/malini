import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserRequest, BrowserResult } from '../protocol.js';
import { maliniTools } from './browser-tools.js';

type Transport = Parameters<McpSdkServerConfigWithInstance['instance']['connect']>[0];
type JsonRpcMessage = Parameters<Transport['send']>[0];

const scratch: string[] = [];

afterEach(() => {
	for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connect(answer: (request: BrowserRequest) => Promise<BrowserResult>): Promise<{
	readonly requests: BrowserRequest[];
	readonly call: (method: string, params: Record<string, unknown>) => Promise<JsonRpcMessage>;
}> {
	const requests: BrowserRequest[] = [];
	const { mcpServers } = maliniTools(async (request) => {
		requests.push(request);
		return answer(request);
	});
	const server = mcpServers['malini'];
	if (server?.type !== 'sdk') throw new Error('malini is not an in-process MCP server');
	const waiting = new Map<number, (message: JsonRpcMessage) => void>();
	const transport: Transport = {
		async start() {},
		async close() {},
		async send(message) {
			if ('id' in message && typeof message.id === 'number') waiting.get(message.id)?.(message);
		},
	};
	await server.instance.connect(transport);
	let nextId = 0;
	return {
		requests,
		call: (method, params) =>
			new Promise((resolve) => {
				nextId += 1;
				waiting.set(nextId, resolve);
				transport.onmessage?.({ jsonrpc: '2.0', id: nextId, method, params });
			}),
	};
}

describe('malini MCP server', () => {
	it('lists the browser tools with their input schemas', async () => {
		const { call } = await connect(async () => ({ ok: true }));

		const listed = await call('tools/list', {});

		expect(listed).toMatchObject({
			result: {
				tools: [
					{
						name: 'browser_open',
						inputSchema: {
							type: 'object',
							properties: { url: { type: 'string' } },
							required: ['url'],
						},
					},
					{ name: 'browser_screenshot', inputSchema: { type: 'object', properties: {} } },
					{
						name: 'browser_click',
						inputSchema: {
							type: 'object',
							properties: { selector: { type: 'string' } },
							required: ['selector'],
						},
					},
					{
						name: 'browser_type',
						inputSchema: {
							type: 'object',
							properties: {
								selector: { type: 'string' },
								text: { type: 'string' },
								submit: { type: 'boolean', default: false },
							},
							required: ['selector', 'text'],
						},
					},
					{ name: 'browser_back', inputSchema: { type: 'object', properties: {} } },
					{ name: 'browser_forward', inputSchema: { type: 'object', properties: {} } },
					{ name: 'browser_reload', inputSchema: { type: 'object', properties: {} } },
				],
			},
		});
	});

	it('types into a field, submitting only when asked, and steps through history', async () => {
		const { call, requests } = await connect(async () => ({ ok: true }));

		await call('tools/call', {
			name: 'browser_type',
			arguments: { selector: 'input[name=q]', text: 'malini' },
		});
		await call('tools/call', {
			name: 'browser_type',
			arguments: { selector: 'input[name=q]', text: '', submit: true },
		});
		await call('tools/call', { name: 'browser_back', arguments: {} });
		await call('tools/call', { name: 'browser_forward', arguments: {} });
		await call('tools/call', { name: 'browser_reload', arguments: {} });

		expect(requests).toEqual([
			{ action: 'type', selector: 'input[name=q]', text: 'malini', submit: false },
			{ action: 'type', selector: 'input[name=q]', text: '', submit: true },
			{ action: 'back' },
			{ action: 'forward' },
			{ action: 'reload' },
		]);
	});

	it('opens a page through malini and returns what the browser answered', async () => {
		const { call, requests } = await connect(async () => ({
			ok: true,
			text: 'Opened Vite App at http://localhost:5173/',
		}));

		const opened = await call('tools/call', {
			name: 'browser_open',
			arguments: { url: 'http://localhost:5173' },
		});

		expect(requests).toEqual([{ action: 'open', url: 'http://localhost:5173' }]);
		expect(opened).toMatchObject({
			result: { content: [{ type: 'text', text: 'Opened Vite App at http://localhost:5173/' }] },
		});
		expect(opened).not.toHaveProperty('result.isError');
	});

	it('hands the screenshot preview back as an image beside the path to embed', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'malini-browser-tools-'));
		scratch.push(dir);
		const imagePath = join(dir, 'preview.jpg');
		writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
		const text =
			'Screenshot saved to .malini/sandbox/screenshots/x.png. Embed it in your report as ![what it shows](.malini/sandbox/screenshots/x.png).';
		const { call, requests } = await connect(async () => ({ ok: true, text, imagePath }));

		const captured = await call('tools/call', { name: 'browser_screenshot', arguments: {} });

		expect(requests).toEqual([{ action: 'screenshot' }]);
		expect(captured).toMatchObject({
			result: {
				content: [
					{ type: 'text', text },
					{ type: 'image', data: '/9j/2Q==', mimeType: 'image/jpeg' },
				],
			},
		});
	});

	it('reports a refused click or a broken browser as a tool error instead of throwing', async () => {
		const { call, requests } = await connect(async (request) => {
			if (request.action === 'click' && request.selector === '#gone') {
				return { ok: false, error: 'Nothing matches #gone.' };
			}
			throw new Error('the bridge lost malini');
		});

		const refused = await call('tools/call', {
			name: 'browser_click',
			arguments: { selector: '#gone' },
		});
		const broken = await call('tools/call', {
			name: 'browser_click',
			arguments: { selector: 'button' },
		});

		expect(requests).toEqual([
			{ action: 'click', selector: '#gone' },
			{ action: 'click', selector: 'button' },
		]);
		expect(refused).toMatchObject({
			result: { isError: true, content: [{ type: 'text', text: 'Nothing matches #gone.' }] },
		});
		expect(broken).toMatchObject({
			result: { isError: true, content: [{ type: 'text', text: 'the bridge lost malini' }] },
		});
	});
});
