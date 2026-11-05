import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { zstdCompress } from 'node:zlib';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
	AnthropicStream,
	claudeCodeRequest,
	MessageAccumulator,
	parseUpstreamEvent,
	toChatGptRequest,
	UpstreamError,
	upstreamErrorKind,
	type ChatGptRequest,
	type UpstreamErrorKind,
} from './translate';
import { ChatGptError, oauthErrorCode, type ChatGptEndpoints, type ChatGptFetch } from './sign-in';

const compress = promisify(zstdCompress);

const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const RESPONSE_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_ID = /^[\w-]{1,128}$/u;
const USAGE_LIMIT_CODES: ReadonlySet<string> = new Set([
	'subscription_sharing_usage_limit_exceeded',
	'subscription_sharing_workplace_individual_usage_limit_exceeded',
]);
const RETRYABLE_KINDS: ReadonlySet<UpstreamErrorKind> = new Set(['overloaded', 'server']);
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
	'network_error',
	'keys_unavailable',
	'discovery_failed',
]);

export interface ChatGptProxyDeps {
	readonly endpoints: ChatGptEndpoints;
	readonly fetch: ChatGptFetch;
	readonly accessToken: (force: boolean) => Promise<string>;
	readonly onUsageLimit: (reached: boolean) => void;
	readonly userAgent: string;
}

export interface ProxyAddress {
	readonly baseUrl: string;
	readonly token: string;
}

export class ChatGptProxy {
	readonly #deps: ChatGptProxyDeps;
	readonly #secret = Buffer.from(randomBytes(32).toString('base64url'));
	#server: Server | null = null;
	#address: Promise<ProxyAddress> | null = null;

	constructor(deps: ChatGptProxyDeps) {
		this.#deps = deps;
	}

	address(): Promise<ProxyAddress> {
		this.#address ??= this.#listen().catch((error: unknown) => {
			this.#address = null;
			throw error;
		});
		return this.#address;
	}

	stop(): void {
		this.#server?.close();
		this.#server?.closeAllConnections();
		this.#server = null;
		this.#address = null;
	}

	async #listen(): Promise<ProxyAddress> {
		const server = createServer((request, response) => {
			void this.#handle(request, response, port).catch((error: unknown) => {
				sendError(response, errorOf(error));
			});
		});
		server.requestTimeout = RESPONSE_TIMEOUT_MS;
		let port = 0;
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen({ port: 0, host: '127.0.0.1' }, () => {
				server.removeListener('error', reject);
				const address = server.address();
				if (address && typeof address !== 'string') port = address.port;
				resolve();
			});
		});
		this.#server = server;
		return { baseUrl: `http://127.0.0.1:${port}`, token: this.#secret.toString() };
	}

	async #handle(request: IncomingMessage, response: ServerResponse, port: number): Promise<void> {
		if (request.headers.host !== `127.0.0.1:${port}` || !this.#authorized(request)) {
			sendError(
				response,
				new UpstreamError('authentication', 'Malini did not recognize this caller.'),
			);
			request.resume();
			return;
		}
		const path = URL.parse(request.url ?? '/', `http://127.0.0.1:${port}`)?.pathname;
		if (request.method === 'POST' && path === '/v1/messages') {
			await this.#messages(request, response);
			return;
		}
		if (request.method === 'POST' && path === '/v1/messages/count_tokens') {
			const body = await readBody(request);
			// ponytail: four characters a token, a real tokenizer when Claude Code leans on the count
			sendJson(response, 200, { input_tokens: Math.ceil(body.length / 4) });
			return;
		}
		request.resume();
		sendJson(response, 404, anthropicError('not_found_error', 'Not found.'));
	}

	#authorized(request: IncomingMessage): boolean {
		const bearer = request.headers.authorization?.replace(/^Bearer /u, '');
		const key = request.headers['x-api-key'];
		const offered = Buffer.from(bearer ?? (typeof key === 'string' ? key : ''));
		return offered.length === this.#secret.length && timingSafeEqual(offered, this.#secret);
	}

	async #messages(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const parsed = claudeCodeRequest.safeParse(
			JSON.parse((await readBody(request)).toString('utf8')),
		);
		if (!parsed.success) {
			throw new UpstreamError(
				'invalid-request',
				`ChatGPT cannot take this request: ${parsed.error.issues[0]?.message ?? 'unknown shape'}.`,
			);
		}
		const header = request.headers['x-claude-code-session-id'];
		const sessionId = typeof header === 'string' && SESSION_ID.test(header) ? header : null;
		const translated = toChatGptRequest(parsed.data, sessionId);
		const controller = new AbortController();
		response.once('close', () => controller.abort());
		const stream = new AnthropicStream(parsed.data.model, translated.toolNames);
		const accumulator = new MessageAccumulator();
		const pending: BetaRawMessageStreamEvent[] = [];
		const emit = (events: readonly BetaRawMessageStreamEvent[]): void => {
			if (!translated.stream) {
				for (const event of events) accumulator.apply(event);
				return;
			}
			pending.push(...events);
			if (!response.headersSent && pending.every(({ type }) => type === 'message_start')) return;
			if (!response.headersSent) {
				response.writeHead(200, {
					'content-type': 'text/event-stream',
					'cache-control': 'no-cache',
					connection: 'keep-alive',
				});
			}
			for (const event of pending.splice(0)) {
				response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
			}
		};
		try {
			const upstream = await this.#send(translated.body, sessionId, controller.signal);
			for await (const data of serverSentData(upstream)) {
				const event = parseUpstreamEvent(data);
				if (event) emit(stream.next(event));
				if (stream.done) break;
			}
			if (!stream.done) {
				throw new UpstreamError('overloaded', 'ChatGPT stopped the response before it finished.');
			}
		} catch (error) {
			const failure = errorOf(error);
			this.#deps.onUsageLimit(isUsageLimit(failure));
			if (!response.headersSent) throw failure;
			const { type, message } = anthropicErrorOf(failure);
			response.end(`event: error\ndata: ${JSON.stringify(anthropicError(type, message))}\n\n`);
			return;
		}
		this.#deps.onUsageLimit(false);
		if (translated.stream) response.end();
		else sendJson(response, 200, accumulator.message());
	}

	async #send(
		body: ChatGptRequest,
		sessionId: string | null,
		signal: AbortSignal,
	): Promise<Response> {
		const compressed = await compress(Buffer.from(JSON.stringify(body)));
		const attempt = async (force: boolean): Promise<Response> =>
			this.#deps.fetch(`${this.#deps.endpoints.resource}/responses`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${await this.#deps.accessToken(force)}`,
					'content-type': 'application/json',
					'content-encoding': 'zstd',
					accept: 'text/event-stream',
					'user-agent': this.#deps.userAgent,
					...(sessionId ? { 'session-id': sessionId } : {}),
				},
				body: new Uint8Array(compressed),
				redirect: 'error',
				signal: AbortSignal.any([signal, AbortSignal.timeout(RESPONSE_TIMEOUT_MS)]),
			});
		const first = await attempt(false);
		const response =
			first.status === 401 ? (await first.body?.cancel(), await attempt(true)) : first;
		if (response.ok && response.body) return response;
		throw await upstreamFailure(response);
	}
}

async function upstreamFailure(response: Response): Promise<UpstreamError> {
	const text = await response.text().catch(() => '');
	const body = parseJson(text);
	const code = oauthErrorCode(body);
	const kind = code ? upstreamErrorKind(code) : kindOfStatus(response.status);
	return new UpstreamError(
		kind,
		upstreamMessage(body) ?? `ChatGPT answered ${response.status}.`,
		code,
	);
}

function kindOfStatus(status: number): UpstreamErrorKind {
	if (status === 401) return 'authentication';
	if (status === 403) return 'permission';
	if (status === 413) return 'prompt-too-long';
	if (status === 429) return 'rate-limit';
	if (status === 503 || status === 529) return 'overloaded';
	if (status >= 500) return 'server';
	return 'invalid-request';
}

function upstreamMessage(body: unknown): string | null {
	const error = isObject(body) ? body['error'] : undefined;
	const message = isObject(error) ? error['message'] : undefined;
	return typeof message === 'string' && message.length > 0 ? message.slice(0, 500) : null;
}

async function* serverSentData(response: Response): AsyncGenerator<string> {
	const body = response.body;
	if (!body) return;
	let buffer = '';
	for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
		buffer += chunk;
		let boundary = buffer.search(/\r?\n\r?\n/u);
		while (boundary !== -1) {
			const block = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/u, '');
			const data = dataOf(block);
			if (data) yield data;
			boundary = buffer.search(/\r?\n\r?\n/u);
		}
	}
	const data = dataOf(buffer);
	if (data) yield data;
}

function dataOf(block: string): string | null {
	const lines = block
		.split(/\r?\n/u)
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).replace(/^ /u, ''));
	return lines.length > 0 ? lines.join('\n') : null;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		size += buffer.length;
		if (size > MAX_REQUEST_BYTES) {
			throw new UpstreamError(
				'prompt-too-long',
				'Prompt is too long for Malini to send to ChatGPT.',
			);
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

function errorOf(error: unknown): UpstreamError {
	if (error instanceof UpstreamError) return error;
	if (error instanceof SyntaxError) {
		return new UpstreamError('invalid-request', 'Malini could not read this request.');
	}
	if (error instanceof ChatGptError) {
		const kind = UNREACHABLE_CODES.has(error.code) ? 'overloaded' : 'authentication';
		return new UpstreamError(kind, error.message, error.code);
	}
	return new UpstreamError('server', error instanceof Error ? error.message : String(error));
}

function anthropicErrorOf(error: UpstreamError): {
	status: number;
	type: string;
	message: string;
} {
	switch (error.kind) {
		case 'authentication':
			return { status: 401, type: 'authentication_error', message: error.message };
		case 'permission':
			return {
				status: 403,
				type: 'permission_error',
				message: planMessage(error.code) ?? error.message,
			};
		case 'invalid-request':
			return {
				status: 400,
				type: 'invalid_request_error',
				message: planMessage(error.code) ?? error.message,
			};
		case 'prompt-too-long':
			return {
				status: 400,
				type: 'invalid_request_error',
				message: `Prompt is too long. ${error.message}`,
			};
		case 'rate-limit':
			return {
				status: 429,
				type: 'rate_limit_error',
				message: planMessage(error.code) ?? error.message,
			};
		case 'overloaded':
			return {
				status: 529,
				type: 'overloaded_error',
				message: planMessage(error.code) ?? error.message,
			};
		case 'server':
			return { status: 500, type: 'api_error', message: error.message };
	}
}

function planMessage(code: string | null): string | null {
	switch (code) {
		case 'subscription_sharing_usage_limit_exceeded':
		case 'subscription_sharing_workplace_individual_usage_limit_exceeded':
			return 'You hit your ChatGPT usage limit. See chatgpt.com/settings/usage.';
		case 'subscription_sharing_user_not_eligible':
			return 'This ChatGPT account cannot share its plan with apps.';
		case 'subscription_sharing_unsupported_capability':
		case 'subscription_sharing_route_not_supported':
			return 'ChatGPT does not support part of this request on your plan.';
		case 'subscription_sharing_usage_unavailable':
		case 'subscription_sharing_user_unavailable':
			return 'ChatGPT could not check your plan. Try again shortly.';
		case 'model_not_found':
			return 'Your ChatGPT plan does not include this model.';
		default:
			return null;
	}
}

function sendError(response: ServerResponse, error: UpstreamError): void {
	if (response.headersSent) {
		response.end();
		return;
	}
	const { status, type, message } = anthropicErrorOf(error);
	const retry =
		RETRYABLE_KINDS.has(error.kind) || (error.kind === 'rate-limit' && !isUsageLimit(error));
	sendJson(response, status, anthropicError(type, message), { 'x-should-retry': String(retry) });
}

function isUsageLimit(error: UpstreamError): boolean {
	return error.code !== null && USAGE_LIMIT_CODES.has(error.code);
}

function anthropicError(type: string, message: string): Record<string, unknown> {
	return { type: 'error', error: { type, message } };
}

function sendJson(
	response: ServerResponse,
	status: number,
	body: unknown,
	headers: Readonly<Record<string, string>> = {},
): void {
	response.writeHead(status, { 'content-type': 'application/json', ...headers });
	response.end(JSON.stringify(body));
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
