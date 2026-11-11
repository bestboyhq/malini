import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import {
	anthropicError,
	LocalEndpoint,
	readBody,
	sendJson,
	type ProxyAddress,
} from './local-endpoint';

export interface KeyUpstream {
	readonly baseUrl: string;
	readonly apiKey: string;
}

export interface KeyProxyDeps {
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	readonly upstream: (providerId: string) => Promise<KeyUpstream>;
}

const ROUTE = /^\/([a-z0-9][a-z0-9-]{0,63})(\/v1\/messages(?:\/count_tokens)?)$/u;
const FORWARDED_HEADER =
	/^(?:accept|anthropic-[\w-]+|content-type|user-agent|x-(?!api-key$)[\w-]+)$/u;
const DROPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
	'connection',
	'content-encoding',
	'content-length',
	'keep-alive',
	'transfer-encoding',
]);

class Refusal extends Error {
	constructor(
		readonly status: number,
		readonly type: string,
		message: string,
	) {
		super(message);
	}
}

export class KeyProxy {
	readonly #deps: KeyProxyDeps;
	readonly #endpoint = new LocalEndpoint(
		(request, response, url) => this.#forward(request, response, url),
		sendFailure,
	);

	constructor(deps: KeyProxyDeps) {
		this.#deps = deps;
	}

	async address(providerId: string): Promise<ProxyAddress> {
		const { baseUrl, token } = await this.#endpoint.address();
		return { baseUrl: `${baseUrl}/${providerId}`, token };
	}

	stop(): void {
		this.#endpoint.stop();
	}

	async #forward(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
		const [, providerId, path] = ROUTE.exec(url.pathname) ?? [];
		if (request.method !== 'POST' || providerId === undefined || path === undefined) {
			request.resume();
			throw new Refusal(404, 'not_found_error', 'Not found.');
		}
		const upstream = await this.#deps.upstream(providerId).catch((error: unknown) => {
			request.resume();
			throw new Refusal(401, 'authentication_error', messageOf(error));
		});
		const body = await readBody(
			request,
			() => new Refusal(413, 'request_too_large', 'Prompt is too long.'),
		);
		const controller = new AbortController();
		response.once('close', () => controller.abort());
		const answer = await this.#deps.fetch(
			`${upstream.baseUrl.replace(/\/+$/u, '')}${path}${url.search}`,
			{
				method: 'POST',
				headers: forwardedHeaders(request, upstream.apiKey),
				body: new Uint8Array(body),
				redirect: 'error',
				signal: controller.signal,
			},
		);
		response.writeHead(answer.status, returnedHeaders(answer.headers));
		if (answer.body) await pipeline(answer.body, response);
		else response.end();
	}
}

function forwardedHeaders(request: IncomingMessage, apiKey: string): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (value !== undefined && FORWARDED_HEADER.test(name)) {
			headers.set(name, Array.isArray(value) ? value.join(', ') : value);
		}
	}
	headers.set('authorization', `Bearer ${apiKey}`);
	return headers;
}

function returnedHeaders(headers: Headers): OutgoingHttpHeaders {
	return Object.fromEntries(
		[...headers].filter(([name]) => !DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())),
	);
}

function sendFailure(response: ServerResponse, error: unknown): void {
	if (!(error instanceof Refusal) || response.headersSent) {
		response.destroy();
		return;
	}
	sendJson(response, error.status, anthropicError(error.type, error.message), {
		'x-should-retry': 'false',
	});
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
