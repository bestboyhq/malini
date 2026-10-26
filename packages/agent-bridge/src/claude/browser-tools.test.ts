import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type {
	BrowserRequest,
	BrowserResult,
	PlatformResult,
	PlatformToolCall,
} from '../protocol.js';
import { maliniTools } from './browser-tools.js';

type Transport = Parameters<McpSdkServerConfigWithInstance['instance']['connect']>[0];
type JsonRpcMessage = Parameters<Transport['send']>[0];

const scratch: string[] = [];

afterEach(() => {
	for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connect(
	answer: (request: BrowserRequest) => Promise<BrowserResult>,
	answerPlatform: (call: PlatformToolCall) => Promise<PlatformResult> = async () => ({ ok: true }),
	lead = true,
): Promise<{
	readonly requests: BrowserRequest[];
	readonly platformCalls: PlatformToolCall[];
	readonly call: (method: string, params: Record<string, unknown>) => Promise<JsonRpcMessage>;
}> {
	const requests: BrowserRequest[] = [];
	const platformCalls: PlatformToolCall[] = [];
	const { mcpServers } = maliniTools(
		async (request) => {
			requests.push(request);
			return answer(request);
		},
		async (call) => {
			platformCalls.push(call);
			return answerPlatform(call);
		},
		lead,
	);
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
		platformCalls,
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
					{
						name: 'browser_resize',
						inputSchema: {
							type: 'object',
							properties: { width: { type: 'integer' } },
							required: ['width'],
						},
					},
					{ name: 'jobs_list' },
					{ name: 'jobs_save' },
					{ name: 'jobs_run' },
					{ name: 'events_list' },
					{ name: 'repositories_list' },
					{ name: 'repositories_clone' },
					{ name: 'repositories_hide' },
					{ name: 'workstreams_list' },
					{ name: 'workstreams_create' },
					{ name: 'workstreams_archive' },
					{ name: 'files_open' },
				],
			},
		});
	});

	it('offers and names workstreams_create to a lead chat only', async () => {
		const tools = async (lead: boolean): Promise<unknown> => {
			const { call } = await connect(async () => ({ ok: true }), undefined, lead);
			const listed = await call('tools/list', {});
			return 'result' in listed ? listed.result['tools'] : [];
		};

		expect(JSON.stringify(await tools(true))).toContain('workstreams_create');
		expect(JSON.stringify(await tools(false))).not.toContain('workstreams_create');
	});

	it('types into a field, submitting only when asked, steps through history and resizes the tab', async () => {
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
		await call('tools/call', { name: 'browser_resize', arguments: { width: 1280 } });

		expect(requests).toEqual([
			{ action: 'type', selector: 'input[name=q]', text: 'malini', submit: false },
			{ action: 'type', selector: 'input[name=q]', text: '', submit: true },
			{ action: 'back' },
			{ action: 'forward' },
			{ action: 'reload' },
			{ action: 'resize', width: 1280 },
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

	it('pre-approves the browser, the read tools and opening a file for the user, never a tool that changes Malini', () => {
		const { allowedTools } = maliniTools(
			async () => ({ ok: true }),
			async () => ({ ok: true }),
			false,
		);

		expect(allowedTools.filter((name) => !name.startsWith('mcp__malini__browser_'))).toEqual([
			'mcp__malini__jobs_list',
			'mcp__malini__events_list',
			'mcp__malini__repositories_list',
			'mcp__malini__workstreams_list',
			'mcp__malini__files_open',
		]);
	});

	it('describes every field of the job tools to the agent', async () => {
		const { call } = await connect(async () => ({ ok: true }));

		const listed = await call('tools/list', {});
		const tools =
			'result' in listed && Array.isArray(listed.result['tools']) ? listed.result['tools'] : [];
		const schemaOf = (name: string): unknown =>
			tools.find((tool: { name?: unknown }) => tool.name === name)?.inputSchema;

		expect(schemaOf('jobs_save')).toMatchObject({
			type: 'object',
			properties: {
				id: { type: 'string', description: expect.any(String) },
				name: { type: 'string', description: expect.any(String) },
				instructions: { type: 'string', description: expect.any(String) },
				model: { enum: ['opus', 'sonnet', 'haiku'], description: expect.any(String) },
				effort: {
					enum: ['low', 'medium', 'high', 'xhigh', 'max'],
					description: expect.any(String),
				},
				runsIn: { enum: ['workstream', 'new-workstream'], description: expect.any(String) },
				when: { description: expect.any(String) },
				then: { description: expect.any(String) },
			},
		});
		expect(schemaOf('jobs_save')).not.toHaveProperty('properties.output');
		expect(schemaOf('jobs_save')).not.toHaveProperty('required');
		expect(schemaOf('jobs_run')).toMatchObject({
			properties: {
				job: { type: 'string', description: expect.any(String) },
				context: { type: 'string', description: expect.any(String) },
				workstream: { type: 'string', description: expect.any(String) },
			},
			required: ['job'],
		});
		expect(schemaOf('workstreams_create')).toMatchObject({
			properties: {
				repository: { type: 'string', description: expect.any(String) },
				prompt: { type: 'string', description: expect.any(String) },
			},
			required: ['repository', 'prompt'],
		});
		expect(schemaOf('workstreams_archive')).toMatchObject({ required: ['workstream'] });
		expect(schemaOf('repositories_clone')).toMatchObject({ required: ['repository'] });
		expect(schemaOf('repositories_hide')).toMatchObject({ required: ['repository'] });
		expect(schemaOf('files_open')).toMatchObject({
			properties: {
				path: { type: 'string', description: expect.any(String) },
				line: { type: 'integer', exclusiveMinimum: 0, description: expect.any(String) },
				keys: {
					type: 'array',
					items: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
					description: expect.any(String),
				},
			},
			required: ['path'],
		});
		const jobsSave = tools.find((tool: { name?: unknown }) => tool.name === 'jobs_save')
			?.inputSchema?.properties?.when?.description;
		expect(jobsSave).toContain('`on <channel>`');
		expect(jobsSave).toContain('null for a job that runs only when asked');
	});

	it('sends each job tool call to malini and returns its answer as text', async () => {
		const { call, platformCalls } = await connect(
			async () => ({ ok: true }),
			async ({ tool }) =>
				tool === 'jobs_run'
					? { ok: false, error: 'No job is named "Ship it".' }
					: { ok: true, text: `[${tool}]` },
		);

		const listed = await call('tools/call', { name: 'jobs_list', arguments: {} });
		const saved = await call('tools/call', {
			name: 'jobs_save',
			arguments: {
				id: 'job-1',
				when: 'on pull-requests:ship-changed where merged is set',
				then: null,
			},
		});
		const refused = await call('tools/call', { name: 'jobs_run', arguments: { job: 'Ship it' } });
		const hidden = await call('tools/call', {
			name: 'repositories_hide',
			arguments: { repository: 'acme/site' },
		});
		const invalid = await call('tools/call', { name: 'jobs_save', arguments: { effort: 'huge' } });

		expect(platformCalls).toEqual([
			{ tool: 'jobs_list', input: {} },
			{
				tool: 'jobs_save',
				input: {
					id: 'job-1',
					when: 'on pull-requests:ship-changed where merged is set',
					then: null,
				},
			},
			{ tool: 'jobs_run', input: { job: 'Ship it' } },
			{ tool: 'repositories_hide', input: { repository: 'acme/site' } },
		]);
		expect(hidden).toMatchObject({
			result: { content: [{ type: 'text', text: '[repositories_hide]' }] },
		});
		expect(listed).toMatchObject({
			result: { content: [{ type: 'text', text: '[jobs_list]' }] },
		});
		expect(saved).toMatchObject({
			result: { content: [{ type: 'text', text: '[jobs_save]' }] },
		});
		expect(refused).toMatchObject({
			result: { isError: true, content: [{ type: 'text', text: 'No job is named "Ship it".' }] },
		});
		expect(invalid).toMatchObject({ result: { isError: true } });
	});
});
