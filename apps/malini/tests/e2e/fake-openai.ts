import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
	createServer,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { buffer } from 'node:stream/consumers';
import { zstdDecompressSync } from 'node:zlib';

const CHATGPT_CLIENT_ID = 'oaiapp_e2e';
export const CHATGPT_EMAIL = 'gpt-user@example.com';

const KEY_ID = 'e2e-key';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

export type UpstreamResponse = Readonly<{ headers: IncomingHttpHeaders; body: unknown }>;

type Reply = Readonly<{ status: number; type: string; body: string }>;

type Authorization = Readonly<{ redirectUri: string; challenge: string; nonce: string }>;

export type FakeOpenAi = Readonly<{
	url: string;
	resource: string;
	responses: UpstreamResponse[];
	revoked: URLSearchParams[];
	replyWithUsageLimit(): void;
	close(): void;
}>;

const MODELS = {
	models: [
		model('gpt-6.1-sol', 'GPT-6.1 Sol'),
		model('gpt-6.1-terra', 'GPT-6.1 Terra'),
		model('gpt-6-luna', 'GPT-6 Luna'),
		{ ...model('gpt-6.1-sol-preview', 'GPT-6.1 Sol Preview'), visibility: 'hide' },
	],
};

function model(slug: string, name: string): Record<string, unknown> {
	return {
		slug,
		display_name: name,
		visibility: 'list',
		supported_in_api: true,
		context_window: 400_000,
		input_modalities: ['text', 'image'],
		supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh'].map((effort) => ({ effort })),
	};
}

function json(status: number, body: unknown): Reply {
	return { status, type: 'application/json', body: JSON.stringify(body) };
}

function events(...items: readonly Record<string, unknown>[]): Reply {
	return {
		status: 200,
		type: 'text/event-stream',
		body: items
			.map(
				(item, index) =>
					`event: ${String(item['type'])}\ndata: ${JSON.stringify({ ...item, sequence_number: index })}\n\n`,
			)
			.join(''),
	};
}

function greeting(): Reply {
	const message = { id: 'msg_e2e', type: 'message', role: 'assistant' };
	return events(
		{ type: 'response.created', response: { id: 'resp_e2e', status: 'in_progress', output: [] } },
		{
			type: 'response.output_item.added',
			output_index: 0,
			item: { ...message, status: 'in_progress', content: [] },
		},
		{
			type: 'response.output_text.delta',
			item_id: 'msg_e2e',
			output_index: 0,
			content_index: 0,
			delta: 'Hello from GPT-6.1 Sol',
			logprobs: [],
		},
		{
			type: 'response.output_item.done',
			output_index: 0,
			item: {
				...message,
				status: 'completed',
				content: [{ type: 'output_text', text: 'Hello from GPT-6.1 Sol', annotations: [] }],
			},
		},
		{
			type: 'response.completed',
			response: {
				id: 'resp_e2e',
				status: 'completed',
				output: [],
				usage: { input_tokens: 40, input_tokens_details: { cached_tokens: 0 }, output_tokens: 6 },
			},
		},
	);
}

export async function fakeOpenAi(): Promise<FakeOpenAi> {
	const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const url = `http://localhost:${(server.address() as AddressInfo).port}`;
	const resource = `${url}/v1`;
	const codes = new Map<string, Authorization>();
	const responses: UpstreamResponse[] = [];
	const revoked: URLSearchParams[] = [];
	let accessToken = '';
	let issued = 0;
	let usageLimit = false;

	const idToken = (nonce: string): string => {
		const iat = Math.floor(Date.now() / 1000);
		const claims = { iss: url, aud: CHATGPT_CLIENT_ID, sub: 'user-e2e', email: CHATGPT_EMAIL };
		const encode = (value: unknown): string =>
			Buffer.from(JSON.stringify(value)).toString('base64url');
		const signed = `${encode({ alg: 'RS256', typ: 'JWT', kid: KEY_ID })}.${encode({
			...claims,
			name: 'GPT User',
			iat,
			exp: iat + 3600,
			nonce,
		})}`;
		return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`;
	};

	const token = (form: URLSearchParams): Reply => {
		const authorization = codes.get(form.get('code') ?? '');
		const challenge = createHash('sha256')
			.update(form.get('code_verifier') ?? '')
			.digest('base64url');
		if (
			form.get('grant_type') !== 'authorization_code' ||
			form.get('client_id') !== CHATGPT_CLIENT_ID ||
			form.get('resource') !== resource ||
			authorization?.redirectUri !== form.get('redirect_uri') ||
			authorization.challenge !== challenge
		) {
			return json(400, { error: 'invalid_grant' });
		}
		issued += 1;
		accessToken = `at-e2e-${issued}`;
		return json(200, {
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: 3600,
			refresh_token: `rt-e2e-${issued}`,
			scope: SCOPES,
			id_token: idToken(authorization.nonce),
		});
	};

	const authorize = (query: URLSearchParams, response: ServerResponse): void => {
		const code = `code-${codes.size + 1}`;
		codes.set(code, {
			redirectUri: query.get('redirect_uri') ?? '',
			challenge: query.get('code_challenge') ?? '',
			nonce: query.get('nonce') ?? '',
		});
		const callback = new URL(query.get('redirect_uri') ?? '');
		callback.search = new URLSearchParams({
			code,
			state: query.get('state') ?? '',
			client_id: CHATGPT_CLIENT_ID,
		}).toString();
		response.writeHead(302, { location: callback.toString() }).end();
	};

	const infer = (headers: IncomingHttpHeaders, body: Buffer): Reply => {
		responses.push({
			headers,
			body:
				headers['content-encoding'] === 'zstd'
					? JSON.parse(zstdDecompressSync(body).toString('utf8'))
					: null,
		});
		if (headers.authorization !== `Bearer ${accessToken}`) {
			return json(401, { error: { code: 'invalid_token', message: 'Unknown token.' } });
		}
		if (!usageLimit) return greeting();
		usageLimit = false;
		return json(429, {
			error: {
				code: 'subscription_sharing_usage_limit_exceeded',
				message: 'You have hit your usage limit.',
			},
		});
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
			case 'POST /oauth/revoke':
				revoked.push(new URLSearchParams(body.toString()));
				return json(200, {});
			case 'GET /v1/models':
				return headers.authorization === `Bearer ${accessToken}`
					? json(200, MODELS)
					: json(401, { error: { code: 'invalid_token', message: 'Unknown token.' } });
			case 'POST /v1/responses':
				return infer(headers, body);
			default:
				return json(404, { error: { message: 'Not found.' } });
		}
	};

	const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		const body = await buffer(request);
		const target = new URL(request.url ?? '/', url);
		if (request.method === 'GET' && target.pathname === '/oauth/authorize') {
			authorize(target.searchParams, response);
			return;
		}
		const reply = route(request.method ?? 'GET', target.pathname, request.headers, body);
		response.writeHead(reply.status, { 'content-type': reply.type }).end(reply.body);
	};
	server.on('request', (request, response) => void handle(request, response));

	return {
		url,
		resource,
		responses,
		revoked,
		replyWithUsageLimit: () => {
			usageLimit = true;
		},
		close: () => {
			server.closeAllConnections();
			server.close();
		},
	};
}
