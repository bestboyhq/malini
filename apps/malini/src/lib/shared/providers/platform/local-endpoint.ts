import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export interface ProxyAddress {
	readonly baseUrl: string;
	readonly token: string;
}

export type LocalHandler = (
	request: IncomingMessage,
	response: ServerResponse,
	url: URL,
) => Promise<void>;

export type LocalFailure = (response: ServerResponse, error: unknown) => void;

export class LocalEndpoint {
	readonly #secret = Buffer.from(randomBytes(32).toString('base64url'));
	readonly #handle: LocalHandler;
	readonly #fail: LocalFailure;
	#server: Server | null = null;
	#address: Promise<ProxyAddress> | null = null;

	constructor(handle: LocalHandler, fail: LocalFailure) {
		this.#handle = handle;
		this.#fail = fail;
	}

	address(): Promise<ProxyAddress> {
		if (this.#address) return this.#address;
		const address = this.#listen().catch((error: unknown) => {
			if (this.#address === address) this.#address = null;
			throw error;
		});
		this.#address = address;
		return address;
	}

	stop(): void {
		this.#server?.close();
		this.#server?.closeAllConnections();
		this.#server = null;
		this.#address = null;
	}

	async #listen(): Promise<ProxyAddress> {
		const server = createServer((request, response) => {
			void this.#serve(request, response, port).catch((error: unknown) => {
				this.#fail(response, error);
			});
		});
		server.requestTimeout = REQUEST_TIMEOUT_MS;
		this.#server = server;
		let port = 0;
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.once('close', () => reject(new Error('The local proxy stopped.')));
			server.listen({ port: 0, host: '127.0.0.1' }, () => {
				server.removeListener('error', reject);
				const address = server.address();
				if (address && typeof address !== 'string') port = address.port;
				resolve();
			});
		});
		return { baseUrl: `http://127.0.0.1:${port}`, token: this.#secret.toString() };
	}

	async #serve(request: IncomingMessage, response: ServerResponse, port: number): Promise<void> {
		const origin = `http://127.0.0.1:${port}`;
		if (request.headers.host !== `127.0.0.1:${port}` || !this.#authorized(request)) {
			request.resume();
			sendJson(
				response,
				401,
				anthropicError('authentication_error', 'Malini did not recognize this caller.'),
				{ 'x-should-retry': 'false' },
			);
			return;
		}
		await this.#handle(request, response, URL.parse(request.url ?? '/', origin) ?? new URL(origin));
	}

	#authorized(request: IncomingMessage): boolean {
		const bearer = request.headers.authorization?.replace(/^Bearer /u, '');
		const key = request.headers['x-api-key'];
		const offered = Buffer.from(bearer ?? (typeof key === 'string' ? key : ''));
		return offered.length === this.#secret.length && timingSafeEqual(offered, this.#secret);
	}
}

export async function readBody(request: IncomingMessage, tooLarge: () => Error): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		size += buffer.length;
		if (size > MAX_REQUEST_BYTES) throw tooLarge();
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

export function anthropicError(type: string, message: string): Record<string, unknown> {
	return { type: 'error', error: { type, message } };
}

export function sendJson(
	response: ServerResponse,
	status: number,
	body: unknown,
	headers: Readonly<Record<string, string>> = {},
): void {
	response.writeHead(status, { 'content-type': 'application/json', ...headers });
	response.end(JSON.stringify(body));
}
