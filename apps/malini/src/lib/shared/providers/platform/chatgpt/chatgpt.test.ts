import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
	createServer,
	request as httpRequest,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import { buffer } from 'node:stream/consumers';
import { zstdDecompressSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import { get } from '$main/db/rows';
import type { SecretCipher } from '../claude-accounts.service';
import { getStoredProvider } from '../provider.repository';
import { ChatGptAccount } from './account.service';
import { ChatGptProxy } from './proxy';
import { ChatGptAuth } from './sign-in';

const HOUR = 60 * 60 * 1000;
const CLIENT_ID = 'oaiapp_test';
const KEY_ID = 'key-1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const SESSION = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

const cipher: SecretCipher = {
	isEncryptionAvailable: () => true,
	encryptString: (plainText) => Buffer.from(`sealed:${plainText}`),
	decryptString: (encrypted) => encrypted.toString().replace(/^sealed:/u, ''),
};

interface Reply {
	readonly status: number;
	readonly type: string;
	readonly body: string;
}

interface Authorization {
	readonly redirectUri: string;
	readonly challenge: string;
	readonly nonce: string;
}

interface FakeOpenAi {
	readonly url: string;
	readonly requests: string[];
	readonly grants: URLSearchParams[];
	readonly revoked: URLSearchParams[];
	readonly responses: Array<{ headers: IncomingHttpHeaders; body: unknown }>;
	readonly replies: Reply[];
	readonly codes: Map<string, Authorization>;
	readonly refreshTokens: Set<string>;
}

interface Browser {
	readonly opened: URL[];
	readonly callbacks: number[];
	state: string | null;
	codeHonored: boolean;
}

function json(status: number, body: unknown): Reply {
	return { status, type: 'application/json', body: JSON.stringify(body) };
}

function sse(events: readonly Record<string, unknown>[]): Reply {
	return {
		status: 200,
		type: 'text/event-stream',
		body: events
			.map((event) => `event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`)
			.join(''),
	};
}

function idToken(claims: Record<string, unknown>): string {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const signed = `${encode({ alg: 'RS256', typ: 'JWT', kid: KEY_ID })}.${encode(claims)}`;
	return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`;
}

async function fakeOpenAi(now: () => number): Promise<FakeOpenAi> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	const port = address !== null && typeof address === 'object' ? address.port : 0;
	const url = `http://127.0.0.1:${port}`;
	cleanups.push(() => {
		server.closeAllConnections();
		server.close();
	});
	const openai: FakeOpenAi = {
		url,
		requests: [],
		grants: [],
		revoked: [],
		responses: [],
		replies: [],
		codes: new Map(),
		refreshTokens: new Set(),
	};
	let issued = 0;
	let accessToken = '';

	const issue = (nonce: string | null): Reply => {
		issued += 1;
		accessToken = `at-${issued}`;
		const refreshToken = `rt-${issued}`;
		openai.refreshTokens.add(refreshToken);
		const iat = Math.floor(now() / 1000);
		return json(200, {
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: 3600,
			refresh_token: refreshToken,
			scope: SCOPES,
			id_token: idToken({
				iss: url,
				aud: CLIENT_ID,
				sub: 'user-1',
				email: 'me@example.com',
				name: 'Me',
				iat,
				exp: iat + 3600,
				...(nonce === null ? {} : { nonce }),
			}),
		});
	};

	const token = (form: URLSearchParams): Reply => {
		openai.grants.push(form);
		const refused = json(400, { error: 'invalid_grant', error_description: 'Not valid.' });
		if (form.get('client_id') !== CLIENT_ID || form.get('resource') !== `${url}/v1`) return refused;
		if (form.get('grant_type') === 'refresh_token') {
			return openai.refreshTokens.delete(form.get('refresh_token') ?? '') ? issue(null) : refused;
		}
		const code = form.get('code') ?? '';
		const authorization = openai.codes.get(code);
		openai.codes.delete(code);
		const challenge = createHash('sha256')
			.update(form.get('code_verifier') ?? '')
			.digest('base64url');
		return form.get('grant_type') === 'authorization_code' &&
			authorization?.redirectUri === form.get('redirect_uri') &&
			authorization.challenge === challenge
			? issue(authorization.nonce)
			: refused;
	};

	const respond = (headers: IncomingHttpHeaders, body: Buffer): Reply => {
		openai.responses.push({
			headers,
			body:
				headers['content-encoding'] === 'zstd'
					? JSON.parse(zstdDecompressSync(body).toString('utf8'))
					: null,
		});
		if (headers.authorization !== `Bearer ${accessToken}`) {
			return json(401, { error: { code: 'invalid_token', message: 'Unknown token.' } });
		}
		return openai.replies.shift() ?? json(500, { error: { message: 'No reply queued.' } });
	};

	const route = (method: string, path: string, headers: IncomingHttpHeaders, body: Buffer) => {
		switch (`${method} ${path}`) {
			case 'GET /.well-known/openid-configuration':
				return json(200, {
					issuer: url,
					authorization_endpoint: `${url}/oauth/authorize`,
					token_endpoint: `${url}/oauth/token`,
					revocation_endpoint: `${url}/oauth/revoke`,
					jwks_uri: `${url}/.well-known/jwks.json`,
				});
			case 'GET /.well-known/jwks.json':
				return json(200, {
					keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KEY_ID, use: 'sig', alg: 'RS256' }],
				});
			case 'POST /oauth/token':
				return token(new URLSearchParams(body.toString()));
			case 'POST /oauth/revoke': {
				const form = new URLSearchParams(body.toString());
				openai.revoked.push(form);
				openai.refreshTokens.delete(form.get('token') ?? '');
				return json(200, {});
			}
			case 'GET /v1/models':
				return headers.authorization === `Bearer ${accessToken}`
					? json(200, MODELS)
					: json(401, { error: { code: 'invalid_token', message: 'Unknown token.' } });
			case 'POST /v1/responses':
				return respond(headers, body);
			default:
				return json(404, { error: { message: 'Not found.' } });
		}
	};

	const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		const body = await buffer(request);
		const path = new URL(request.url ?? '/', url).pathname;
		openai.requests.push(`${request.method} ${path}`);
		const reply = route(request.method ?? 'GET', path, request.headers, body);
		response.writeHead(reply.status, { 'content-type': reply.type }).end(reply.body);
	};
	server.on('request', (request, response) => void handle(request, response));
	return openai;
}

const MODELS = {
	models: [
		{
			slug: 'gpt-6.2-sol',
			display_name: 'GPT-6.2 Sol',
			visibility: 'list',
			supported_in_api: true,
			context_window: 400_000,
			input_modalities: ['text', 'image'],
			supported_reasoning_levels: [
				{ effort: 'low', description: 'Fast' },
				{ effort: 'medium', description: 'Balanced' },
				{ effort: 'high', description: 'Thorough' },
				{ effort: 'xhigh', description: 'Deepest' },
			],
		},
		{
			slug: 'gpt-6.2-sol-internal',
			display_name: 'GPT-6.2 Sol Internal',
			visibility: 'hide',
			supported_in_api: true,
		},
		{
			slug: 'codex-auto-review',
			display_name: 'Codex Auto Review',
			visibility: 'list',
			supported_in_api: false,
		},
	],
};

async function harness() {
	let clock = Date.parse('2026-11-05T09:00:00Z');
	const now = () => clock;
	const openai = await fakeOpenAi(now);
	const db = openMigratedDatabase(':memory:');
	const endpoints = { issuer: openai.url, resource: `${openai.url}/v1` };
	const browser: Browser = { opened: [], callbacks: [], state: null, codeHonored: true };

	const openExternal = async (url: string): Promise<void> => {
		const authorize = new URL(url);
		browser.opened.push(authorize);
		const params = authorize.searchParams;
		const code = `code-${browser.opened.length}`;
		if (browser.codeHonored) {
			openai.codes.set(code, {
				redirectUri: params.get('redirect_uri') ?? '',
				challenge: params.get('code_challenge') ?? '',
				nonce: params.get('nonce') ?? '',
			});
		}
		const callback = new URL(params.get('redirect_uri') ?? '');
		callback.search = new URLSearchParams({
			code,
			state: browser.state ?? params.get('state') ?? '',
			client_id: CLIENT_ID,
		}).toString();
		const response = await fetch(callback);
		await response.text();
		browser.callbacks.push(response.status);
	};

	const reopened = () =>
		new ChatGptAccount({
			db,
			cipher: async () => cipher,
			auth: new ChatGptAuth({ endpoints, fetch, openExternal, now }),
			endpoints,
			fetch,
			now,
		});
	const account = reopened();

	return {
		db,
		openai,
		browser,
		account,
		reopened,
		now,
		advance: (ms: number) => {
			clock += ms;
		},
		signIn: async () => {
			const listed = openai.requests.filter((request) => request === 'GET /v1/models').length;
			expect(await account.signIn()).toBe('signed-in');
			await expect
				.poll(() => openai.requests.filter((request) => request === 'GET /v1/models').length)
				.toBe(listed + 1);
		},
		refreshes: () =>
			openai.grants
				.filter((form) => form.get('grant_type') === 'refresh_token')
				.map((form) => form.get('refresh_token')),
		proxy: () => {
			const proxy = new ChatGptProxy({
				endpoints,
				fetch,
				accessToken: (force) => account.accessToken(force),
				onUsageLimit: (reached) => account.noteUsageLimit(reached),
				userAgent: 'Malini/0.0.0-test',
			});
			cleanups.push(() => proxy.stop());
			return proxy;
		},
	};
}

function claudeCodeTurn(stream: boolean): Record<string, unknown> {
	return {
		model: 'gpt-6.1-sol',
		max_tokens: 32_000,
		stream,
		metadata: { user_id: 'user_abc_account_def_session_ghi' },
		thinking: { type: 'adaptive' },
		output_config: { effort: 'high' },
		system: [
			{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=sdk-ts;' },
			{ type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } },
		],
		tools: [
			{
				name: 'Read',
				description: 'Read a file',
				input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
			},
		],
		messages: [
			{
				role: 'user',
				content: [{ type: 'text', text: 'Say hi.', cache_control: { type: 'ephemeral' } }],
			},
		],
	};
}

function hello(id: string): Reply {
	return sse([
		{
			type: 'response.created',
			sequence_number: 0,
			response: { id, object: 'response', status: 'in_progress', output: [] },
		},
		{
			type: 'response.output_item.added',
			sequence_number: 1,
			output_index: 0,
			item: { id: 'msg_1', type: 'message', status: 'in_progress', role: 'assistant', content: [] },
		},
		{
			type: 'response.output_text.delta',
			sequence_number: 2,
			item_id: 'msg_1',
			output_index: 0,
			content_index: 0,
			delta: 'Hi.',
			logprobs: [],
		},
		{
			type: 'response.output_item.done',
			sequence_number: 3,
			output_index: 0,
			item: {
				id: 'msg_1',
				type: 'message',
				status: 'completed',
				role: 'assistant',
				content: [{ type: 'output_text', text: 'Hi.', annotations: [] }],
			},
		},
		{
			type: 'response.completed',
			sequence_number: 4,
			response: {
				id,
				object: 'response',
				status: 'completed',
				output: [],
				usage: { input_tokens: 50, input_tokens_details: { cached_tokens: 20 }, output_tokens: 3 },
			},
		},
	]);
}

function serverSentEvents(text: string): Array<{ event: string; data: unknown }> {
	return text
		.trim()
		.split('\n\n')
		.map((block) => {
			const [event = '', data = ''] = block.split('\n');
			return {
				event: event.replace(/^event: /u, ''),
				data: JSON.parse(data.replace(/^data: /u, '')),
			};
		});
}

describe('ChatGPT sign-in', () => {
	it('registers Malini in the browser, verifies who signed in and keeps the account and its models', async () => {
		const h = await harness();
		await h.signIn();

		const [authorize] = h.browser.opened;
		expect(`${authorize?.origin}${authorize?.pathname}`).toBe(`${h.openai.url}/oauth/authorize`);
		expect(Object.fromEntries(authorize?.searchParams ?? [])).toEqual({
			client_id: 'dynamic_agent_client',
			agent_name_hint: 'Malini',
			ext_agent_host_id: expect.stringMatching(/^urn:uuid:[0-9a-f-]{36}$/u),
			response_type: 'code',
			redirect_uri: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/u),
			scope: SCOPES,
			resource: `${h.openai.url}/v1`,
			state: expect.any(String),
			nonce: expect.any(String),
			code_challenge_method: 'S256',
			code_challenge: expect.any(String),
		});
		expect(h.browser.callbacks).toEqual([200]);
		expect(h.account.account()).toEqual({
			email: 'me@example.com',
			name: 'Me',
			usageLimitReachedAt: null,
		});
		expect(await h.account.accessToken()).toBe('at-1');
		await expect
			.poll(() => getStoredProvider(h.db, 'chatgpt')?.models)
			.toEqual([
				{
					id: 'gpt-6.2-sol',
					label: 'GPT-6.2 Sol',
					description: 'Text and images, 400K context',
					efforts: ['low', 'medium', 'high', 'xhigh'],
					family: 'gpt-sol',
				},
			]);
	});

	it('turns away a callback with the wrong state and keeps waiting', async () => {
		const h = await harness();
		h.browser.state = 'forged';

		const outcome = h.account.signIn();
		await expect.poll(() => h.browser.callbacks).toEqual([400]);
		expect(h.account.account()).toBeNull();
		h.account.cancelSignIn();

		expect(await outcome).toBe('cancelled');
		expect(h.openai.grants).toEqual([]);
		expect(h.account.account()).toBeNull();
	});

	it('refreshes an expired token once for every caller and signs in again after ChatGPT refuses it', async () => {
		const h = await harness();
		await h.signIn();

		h.advance(2 * HOUR);
		expect(
			await Promise.all([
				h.account.accessToken(),
				h.account.accessToken(),
				h.account.accessToken(),
			]),
		).toEqual(['at-2', 'at-2', 'at-2']);
		h.advance(2 * HOUR);
		expect(await h.reopened().accessToken()).toBe('at-3');
		expect(h.refreshes()).toEqual(['rt-1', 'rt-2']);

		h.openai.refreshTokens.clear();
		h.advance(2 * HOUR);
		await expect(h.account.accessToken()).rejects.toMatchObject({
			code: 'invalid_grant',
			message: 'Your ChatGPT sign-in expired. Sign in again.',
		});
		expect(h.account.account()).toBeNull();

		await h.signIn();
		const [first, again] = h.browser.opened.map((url) => url.searchParams);
		expect(again?.get('client_id')).toBe(CLIENT_ID);
		expect(again?.has('agent_name_hint')).toBe(false);
		expect(again?.get('login_hint')).toBe('me@example.com');
		expect(again?.get('ext_agent_host_id')).toBe(first?.get('ext_agent_host_id'));
		expect(h.account.account()?.email).toBe('me@example.com');
	});

	it('says ChatGPT turned down a fresh sign-in whose code it will not exchange, not that it expired', async () => {
		const h = await harness();
		h.browser.codeHonored = false;

		await expect(h.account.signIn()).rejects.toMatchObject({
			code: 'invalid_grant',
			message: 'ChatGPT turned down the sign-in (invalid_grant).',
		});
		expect(h.browser.callbacks).toEqual([200]);
		expect(h.account.account()).toBeNull();
	});

	it('signs out by revoking the refresh token and forgetting the account', async () => {
		const h = await harness();
		await h.signIn();

		await h.account.signOut();

		expect(h.openai.revoked.map((form) => Object.fromEntries(form))).toEqual([
			{ token: 'rt-1', token_type_hint: 'refresh_token', client_id: CLIENT_ID },
		]);
		expect(h.account.account()).toBeNull();
		expect(
			get(h.db, 'SELECT client_id, subject, email, credentials FROM chatgpt_account WHERE id = 1'),
		).toEqual({ client_id: null, subject: null, email: null, credentials: null });
		await expect(h.account.accessToken()).rejects.toMatchObject({ code: 'signed_out' });
	});
});

describe('ChatGptProxy', () => {
	it('answers Claude Code like Anthropic while it talks to the Responses API on the plan', async () => {
		const h = await harness();
		await h.signIn();
		const { baseUrl, token } = await h.proxy().address();
		const post = (
			body: unknown,
			auth: Record<string, string> = { authorization: `Bearer ${token}` },
		) =>
			fetch(`${baseUrl}/v1/messages`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'anthropic-version': '2023-06-01',
					'x-claude-code-session-id': SESSION,
					...auth,
				},
				body: JSON.stringify(body),
			});

		const stranger = await post(claudeCodeTurn(true), { 'x-api-key': 'not-the-secret' });
		expect(stranger.status).toBe(401);
		expect(await stranger.json()).toEqual({
			type: 'error',
			error: { type: 'authentication_error', message: 'Malini did not recognize this caller.' },
		});
		expect(await rebound(baseUrl, token)).toBe(401);
		expect(h.openai.responses).toEqual([]);

		h.openai.replies.push(
			json(429, {
				error: {
					type: 'usage_limit_reached',
					code: 'subscription_sharing_usage_limit_exceeded',
					message: 'You have reached your usage limit.',
					param: null,
				},
			}),
		);
		const limited = await post(claudeCodeTurn(true));
		expect(limited.status).toBe(429);
		expect(limited.headers.get('x-should-retry')).toBe('false');
		expect(await limited.json()).toEqual({
			type: 'error',
			error: {
				type: 'rate_limit_error',
				message: 'You hit your ChatGPT usage limit. See chatgpt.com/settings/usage.',
			},
		});
		expect(h.account.account()?.usageLimitReachedAt).toBe(new Date(h.now()).toISOString());

		h.openai.replies.push(hello('resp_1'));
		const streamed = await post(claudeCodeTurn(true));
		expect(streamed.status).toBe(200);
		expect(streamed.headers.get('content-type')).toBe('text/event-stream');
		const events = serverSentEvents(await streamed.text());
		expect(events.map(({ event }) => event)).toEqual([
			'message_start',
			'content_block_start',
			'content_block_delta',
			'content_block_stop',
			'message_delta',
			'message_stop',
		]);
		expect(events[2]?.data).toEqual({
			type: 'content_block_delta',
			index: 0,
			delta: { type: 'text_delta', text: 'Hi.' },
		});
		expect(events[4]?.data).toMatchObject({
			delta: { stop_reason: 'end_turn' },
			usage: { input_tokens: 30, cache_read_input_tokens: 20, output_tokens: 3 },
		});
		expect(h.openai.responses.at(-1)).toMatchObject({
			headers: {
				authorization: 'Bearer at-1',
				'content-encoding': 'zstd',
				accept: 'text/event-stream',
				'session-id': SESSION,
				'user-agent': 'Malini/0.0.0-test',
			},
			body: {
				model: 'gpt-6.1-sol',
				instructions: 'You are Claude Code.',
				input: [{ role: 'user', content: [{ type: 'input_text', text: 'Say hi.' }] }],
				tools: [{ type: 'function', name: 'Read', description: 'Read a file', strict: false }],
				reasoning: { effort: 'high', summary: 'auto' },
				include: ['reasoning.encrypted_content'],
				prompt_cache_key: SESSION,
				store: false,
				stream: true,
			},
		});
		expect(h.account.account()?.usageLimitReachedAt).toBeNull();

		h.openai.replies.push(hello('resp_2'));
		const whole = await post(claudeCodeTurn(false));
		expect(whole.status).toBe(200);
		expect(whole.headers.get('content-type')).toBe('application/json');
		expect(await whole.json()).toMatchObject({
			id: 'resp_2',
			type: 'message',
			role: 'assistant',
			model: 'gpt-6.1-sol',
			content: [{ type: 'text', text: 'Hi.', citations: null }],
			stop_reason: 'end_turn',
			usage: { input_tokens: 30, cache_read_input_tokens: 20, output_tokens: 3 },
		});
		expect(h.openai.responses).toHaveLength(3);
	});
});

function rebound(baseUrl: string, token: string): Promise<number | undefined> {
	return new Promise((resolve, reject) => {
		httpRequest(
			`${baseUrl}/v1/messages`,
			{ method: 'POST', headers: { host: 'attacker.example', authorization: `Bearer ${token}` } },
			(response) => {
				response.resume();
				resolve(response.statusCode);
			},
		)
			.on('error', reject)
			.end('{}');
	});
}
