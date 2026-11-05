import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { createServer, type RequestListener } from 'node:http';
import { z } from 'zod';

export const CHATGPT_ISSUER = 'https://auth.openai.com';
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';

const APP_NAME = 'Malini';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const REGISTRATION_CLIENT_ID = 'dynamic_agent_client';
const CALLBACK_PATH = '/auth/callback';
const CLIENT_ID = /^[\w-]{1,200}$/u;
const CLOCK_TOLERANCE_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;
const REAUTHENTICATION_CODES: ReadonlySet<string> = new Set([
	'invalid_grant',
	'invalid_refresh_token',
	'token_expired',
	'refresh_token_expired',
	'refresh_token_invalidated',
	'refresh_token_reused',
]);

export type ChatGptFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ChatGptEndpoints {
	readonly issuer: string;
	readonly resource: string;
}

export interface ChatGptCredentials {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresAt: number;
	readonly scopes: readonly string[];
}

export interface ChatGptIdentity {
	readonly subject: string;
	readonly email: string | null;
	readonly name: string | null;
}

export interface ChatGptConnection {
	readonly clientId: string;
	readonly identity: ChatGptIdentity;
	readonly credentials: ChatGptCredentials;
}

export interface RefreshedCredentials {
	readonly credentials: ChatGptCredentials;
	readonly idToken: string | null;
	readonly receivedAt: number;
}

export interface PreviousConnection {
	readonly clientId: string | null;
	readonly subject: string | null;
	readonly email: string | null;
}

export class ChatGptError extends Error {
	readonly code: string;

	constructor(code: string, message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'ChatGptError';
		this.code = code;
	}

	get needsSignIn(): boolean {
		return REAUTHENTICATION_CODES.has(this.code);
	}
}

const discoveryDocument = z.object({
	issuer: z.string(),
	authorization_endpoint: z.url(),
	token_endpoint: z.url(),
	revocation_endpoint: z.url().exactOptional(),
	jwks_uri: z.url(),
});

type Discovery = z.infer<typeof discoveryDocument>;

const tokenResponse = z.object({
	access_token: z.string().min(1),
	token_type: z.string().refine((type) => type.toLowerCase() === 'bearer'),
	expires_in: z.number().positive(),
	refresh_token: z.string().min(1),
	scope: z.string().exactOptional(),
	id_token: z.string().min(1).exactOptional(),
});

type TokenResponse = z.infer<typeof tokenResponse>;

const jwtHeader = z.object({ alg: z.literal('RS256'), kid: z.string().exactOptional() });

const idTokenClaims = z.object({
	iss: z.string(),
	aud: z.union([z.string(), z.array(z.string())]),
	exp: z.number(),
	iat: z.number(),
	sub: z.string().min(1),
	nonce: z.string().exactOptional(),
	azp: z.string().exactOptional(),
	email: z.string().exactOptional(),
	name: z.string().exactOptional(),
});

const rsaKey = z.looseObject({
	kty: z.literal('RSA'),
	n: z.string(),
	e: z.string(),
	kid: z.string().exactOptional(),
});

const keySet = z.object({ keys: z.array(z.unknown()) });

export interface ChatGptAuthDeps {
	readonly endpoints: ChatGptEndpoints;
	readonly fetch: ChatGptFetch;
	readonly openExternal: (url: string) => Promise<void>;
	readonly now?: () => number;
}

export class ChatGptAuth {
	readonly #deps: ChatGptAuthDeps;
	readonly #now: () => number;
	#discovery: Promise<Discovery> | null = null;
	#keys: Promise<readonly z.infer<typeof rsaKey>[]> | null = null;

	constructor(deps: ChatGptAuthDeps) {
		this.#deps = deps;
		this.#now = deps.now ?? Date.now;
	}

	async authorize(
		previous: PreviousConnection,
		hostId: string,
		signal: AbortSignal,
		onRegistration: (clientId: string) => void,
	): Promise<ChatGptConnection> {
		const state = randomValue();
		const nonce = randomValue();
		const verifier = randomValue();
		const provider = await this.#discover();
		signal.throwIfAborted();
		const listener = await listenForCallback(state, previous.clientId, signal);
		try {
			const authorization = new URL(provider.authorization_endpoint);
			authorization.search = new URLSearchParams({
				client_id: previous.clientId ?? REGISTRATION_CLIENT_ID,
				response_type: 'code',
				redirect_uri: listener.redirectUri,
				scope: SCOPES,
				resource: this.#deps.endpoints.resource,
				state,
				nonce,
				code_challenge_method: 'S256',
				code_challenge: createHash('sha256').update(verifier).digest('base64url'),
				ext_agent_host_id: hostId,
			}).toString();
			if (!previous.clientId) authorization.searchParams.set('agent_name_hint', APP_NAME);
			if (previous.email) authorization.searchParams.set('login_hint', previous.email);
			await this.#deps.openExternal(authorization.toString());
			const callback = await listener.result;
			onRegistration(callback.clientId);
			const tokens = await this.#tokenRequest(
				{
					grant_type: 'authorization_code',
					client_id: callback.clientId,
					code: callback.code,
					code_verifier: verifier,
					redirect_uri: listener.redirectUri,
					resource: this.#deps.endpoints.resource,
				},
				signal,
			);
			if (!tokens.id_token) {
				throw new ChatGptError('invalid_id_token', 'ChatGPT did not say who signed in.');
			}
			const identity = await this.verifyIdentity(
				tokens.id_token,
				callback.clientId,
				nonce,
				this.#now(),
			);
			if (previous.subject && identity.subject !== previous.subject) {
				throw new ChatGptError(
					'account_mismatch',
					'That is a different ChatGPT account. Sign out first to switch accounts.',
				);
			}
			signal.throwIfAborted();
			return {
				clientId: callback.clientId,
				identity,
				credentials: this.#credentials(tokens, null),
			};
		} finally {
			listener.close();
		}
	}

	async refresh(connection: ChatGptConnection): Promise<RefreshedCredentials> {
		const tokens = await this.#tokenRequest(
			{
				grant_type: 'refresh_token',
				client_id: connection.clientId,
				refresh_token: connection.credentials.refreshToken,
				resource: this.#deps.endpoints.resource,
			},
			AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		);
		return {
			credentials: this.#credentials(tokens, connection.credentials.scopes),
			idToken: tokens.id_token ?? null,
			receivedAt: this.#now(),
		};
	}

	async revoke(connection: ChatGptConnection): Promise<boolean> {
		const provider = await this.#discover().catch(() => null);
		const endpoint = provider?.revocation_endpoint;
		if (!endpoint) return false;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const response = await this.#fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					token: connection.credentials.refreshToken,
					token_type_hint: 'refresh_token',
					client_id: connection.clientId,
				}),
			}).catch(() => null);
			await response?.body?.cancel();
			const status = response?.status ?? 0;
			if (status === 200) return true;
			if (status !== 0 && status < 500) return false;
		}
		return false;
	}

	#discover(): Promise<Discovery> {
		this.#discovery ??= this.#loadDiscovery().catch((error: unknown) => {
			this.#discovery = null;
			throw error;
		});
		return this.#discovery;
	}

	async #loadDiscovery(): Promise<Discovery> {
		const { issuer } = this.#deps.endpoints;
		const response = await this.#fetch(`${issuer}/.well-known/openid-configuration`, {
			headers: { accept: 'application/json' },
		});
		const parsed = discoveryDocument.safeParse(await jsonBody(response));
		const origin = new URL(issuer).origin;
		const endpoints = parsed.success
			? [
					parsed.data.authorization_endpoint,
					parsed.data.token_endpoint,
					parsed.data.jwks_uri,
					...(parsed.data.revocation_endpoint ? [parsed.data.revocation_endpoint] : []),
				]
			: [];
		if (
			!response.ok ||
			!parsed.success ||
			parsed.data.issuer !== issuer ||
			endpoints.some((endpoint) => new URL(endpoint).origin !== origin)
		) {
			throw new ChatGptError('discovery_failed', 'ChatGPT sign-in could not be verified.');
		}
		return parsed.data;
	}

	async #tokenRequest(form: Record<string, string>, signal: AbortSignal): Promise<TokenResponse> {
		const provider = await this.#discover();
		const response = await this.#fetch(provider.token_endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				accept: 'application/json',
			},
			body: new URLSearchParams(form),
			signal,
		});
		const body = await jsonBody(response);
		if (!response.ok) throw oauthError(body);
		const parsed = tokenResponse.safeParse(body);
		if (!parsed.success) {
			throw new ChatGptError('invalid_token_response', 'ChatGPT returned an incomplete sign-in.');
		}
		return parsed.data;
	}

	#credentials(
		tokens: TokenResponse,
		previousScopes: readonly string[] | null,
	): ChatGptCredentials {
		const scopes = tokens.scope?.split(/\s+/u).filter(Boolean) ?? previousScopes ?? [];
		if (!scopes.includes(DIRECT_SCOPE)) {
			throw new ChatGptError(
				'scope_not_granted',
				'ChatGPT did not let Malini use your plan. Sign in again and allow it.',
			);
		}
		return {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: this.#now() + tokens.expires_in * 1000,
			scopes,
		};
	}

	async verifyIdentity(
		token: string,
		clientId: string,
		nonce: string | undefined,
		receivedAt: number,
	): Promise<ChatGptIdentity> {
		const [encodedHeader = '', encodedClaims = '', signature = '', ...rest] = token.split('.');
		const header = jwtHeader.safeParse(decodedJson(encodedHeader));
		const claims = idTokenClaims.safeParse(decodedJson(encodedClaims));
		if (rest.length > 0 || !header.success || !claims.success) throw invalidIdentity();
		const key = await this.#signingKey(header.data.kid);
		const signed = verify(
			'RSA-SHA256',
			Buffer.from(`${encodedHeader}.${encodedClaims}`),
			createPublicKey({ key, format: 'jwk' }),
			Buffer.from(signature, 'base64url'),
		);
		const provider = await this.#discover();
		const audiences = typeof claims.data.aud === 'string' ? [claims.data.aud] : claims.data.aud;
		if (
			!signed ||
			claims.data.iss !== provider.issuer ||
			!audiences.includes(clientId) ||
			claims.data.exp * 1000 + CLOCK_TOLERANCE_MS <= receivedAt ||
			(nonce !== undefined && claims.data.nonce !== nonce) ||
			(claims.data.azp !== undefined && claims.data.azp !== clientId) ||
			(audiences.length > 1 && claims.data.azp !== clientId)
		) {
			throw invalidIdentity();
		}
		return {
			subject: claims.data.sub,
			email: claims.data.email ?? null,
			name: claims.data.name ?? null,
		};
	}

	async #signingKey(kid: string | undefined): Promise<z.infer<typeof rsaKey>> {
		const find = (keys: readonly z.infer<typeof rsaKey>[]) =>
			keys.find((key) => kid === undefined || key.kid === kid);
		const cached = this.#keys ? find(await this.#keys) : undefined;
		if (cached) return cached;
		this.#keys = this.#loadKeys();
		const fresh = find(await this.#keys);
		if (!fresh) throw invalidIdentity();
		return fresh;
	}

	async #loadKeys(): Promise<readonly z.infer<typeof rsaKey>[]> {
		const provider = await this.#discover();
		const response = await this.#fetch(provider.jwks_uri, {
			headers: { accept: 'application/json' },
		});
		const parsed = keySet.safeParse(await jsonBody(response));
		if (!response.ok || !parsed.success) {
			this.#keys = null;
			throw new ChatGptError('keys_unavailable', 'ChatGPT sign-in is not reachable right now.');
		}
		return parsed.data.keys.flatMap((key) => {
			const rsa = rsaKey.safeParse(key);
			return rsa.success ? [rsa.data] : [];
		});
	}

	async #fetch(url: string, init: RequestInit): Promise<Response> {
		const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		try {
			return await this.#deps.fetch(url, {
				...init,
				signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
				redirect: 'error',
			});
		} catch (error) {
			if (init.signal?.aborted) throw cancelled();
			throw new ChatGptError(
				'network_error',
				'Malini could not reach ChatGPT. Check your connection, then try again.',
				error,
			);
		}
	}
}

interface CallbackResult {
	readonly code: string;
	readonly clientId: string;
}

interface CallbackListener {
	readonly result: Promise<CallbackResult>;
	readonly redirectUri: string;
	close(): void;
}

const RETURN_SCRIPT = 'history.replaceState(null, "", "/auth/complete");';
const RETURN_SCRIPT_HASH = createHash('sha256').update(RETURN_SCRIPT).digest('base64');
const RETURN_PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>Back to Malini</title><style>body{font:16px system-ui;max-width:32rem;margin:18vh auto;padding:24px}h1{font-size:24px}</style><h1>Back to Malini</h1><p>Malini has your ChatGPT sign-in. You can close this tab.</p><script>${RETURN_SCRIPT}</script></html>`;

async function listenForCallback(
	state: string,
	savedClientId: string | null,
	signal: AbortSignal,
): Promise<CallbackListener> {
	let complete: (value: CallbackResult) => void = () => undefined;
	let fail: (error: Error) => void = () => undefined;
	let settled = false;
	const result = new Promise<CallbackResult>((resolve, reject) => {
		complete = resolve;
		fail = reject;
	});
	void result.catch(() => undefined);
	const finish = (value: CallbackResult | Error): void => {
		if (settled) return;
		settled = true;
		if (value instanceof Error) fail(value);
		else complete(value);
	};
	let port = 0;
	const handler: RequestListener = (request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('Referrer-Policy', 'no-referrer');
		response.setHeader(
			'Content-Security-Policy',
			`default-src 'none'; script-src 'sha256-${RETURN_SCRIPT_HASH}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'`,
		);
		const origin = `http://127.0.0.1:${port}`;
		const url = URL.parse(request.url ?? '/', origin);
		if (
			request.method !== 'GET' ||
			request.headers.host !== `127.0.0.1:${port}` ||
			url?.origin !== origin ||
			url.pathname !== CALLBACK_PATH ||
			settled
		) {
			response.writeHead(404).end('Not found');
			return;
		}
		if (!sameSecret(url.searchParams.getAll('state'), state)) {
			response.writeHead(400).end('This sign-in is out of date. Start it again in Malini.');
			return;
		}
		response.setHeader('Content-Type', 'text/html; charset=utf-8');
		response.end(RETURN_PAGE);
		const error = url.searchParams.get('error');
		if (error !== null) {
			finish(error === 'access_denied' ? cancelled() : oauthError({ error }));
			return;
		}
		const codes = url.searchParams.getAll('code');
		const returned = url.searchParams.getAll('client_id');
		const clientId = returned[0] ?? savedClientId;
		const [code] = codes;
		if (
			code === undefined ||
			codes.length !== 1 ||
			returned.length > 1 ||
			!clientId ||
			!CLIENT_ID.test(clientId) ||
			clientId === REGISTRATION_CLIENT_ID ||
			(savedClientId !== null && returned[0] !== undefined && returned[0] !== savedClientId)
		) {
			finish(
				new ChatGptError('registration_incomplete', 'ChatGPT did not finish setting up Malini.'),
			);
			return;
		}
		finish({ code, clientId });
	};
	const server = createServer(handler);
	server.requestTimeout = 15_000;
	server.headersTimeout = 10_000;
	const abort = (): void => {
		finish(cancelled());
		close();
	};
	const close = (): void => {
		signal.removeEventListener('abort', abort);
		server.close();
		server.closeAllConnections();
	};
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen({ port: 0, host: '127.0.0.1' }, () => {
			server.removeListener('error', reject);
			const address = server.address();
			if (address && typeof address !== 'string') port = address.port;
			resolve();
		});
	});
	server.on('error', () =>
		finish(new ChatGptError('callback_failed', 'The sign-in listener stopped. Try again.')),
	);
	signal.addEventListener('abort', abort, { once: true });
	if (signal.aborted) abort();
	return { result, close, redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}` };
}

function sameSecret(values: readonly string[], expected: string): boolean {
	const [value] = values;
	if (values.length !== 1 || value === undefined) return false;
	const actual = Buffer.from(value);
	const wanted = Buffer.from(expected);
	return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function oauthError(body: unknown): ChatGptError {
	const code = oauthErrorCode(body) ?? 'oauth_error';
	return new ChatGptError(
		code,
		REAUTHENTICATION_CODES.has(code)
			? 'Your ChatGPT sign-in expired. Sign in again.'
			: `ChatGPT turned down the sign-in (${code}).`,
	);
}

export function oauthErrorCode(body: unknown): string | null {
	let detail: unknown = body;
	for (let depth = 0; depth < 4; depth += 1) {
		if (!isObject(detail)) return null;
		const { error, code } = detail;
		if (typeof error === 'string') return safeCode(error);
		if (typeof code === 'string') return safeCode(code);
		detail = isObject(error) ? error : detail['detail'];
	}
	return null;
}

function safeCode(value: string): string | null {
	return /^[\w.:-]{1,100}$/u.test(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function jsonBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function decodedJson(part: string): unknown {
	try {
		return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
}

function randomValue(): string {
	return randomBytes(32).toString('base64url');
}

function invalidIdentity(): ChatGptError {
	return new ChatGptError(
		'invalid_id_token',
		'ChatGPT sign-in could not be verified. Sign in again.',
	);
}

function cancelled(): ChatGptError {
	return new ChatGptError('cancelled', 'Sign-in was cancelled.');
}
