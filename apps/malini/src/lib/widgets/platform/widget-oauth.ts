import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type RequestListener } from 'node:http';
import { widgetSite } from '$contract/widgets';
import { isRecord } from '$main/db/rows';
import { readBounded, type Fetch } from '$main/fs/download';
import { WidgetError } from './widget-files';

const REQUEST_TIMEOUT_MS = 20_000;
const ANSWER_MAX_BYTES = 1024 * 1024;
const CALLBACK_PATH = '/callback';
const EXPIRY_MARGIN_MS = 60_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SIGNED_OUT_CODES = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

export type OAuthDeps = Readonly<{ fetch: Fetch; openExternal: (url: string) => Promise<void> }>;

export type Grant = Readonly<{
	tokenEndpoint: string;
	clientId: string;
	clientSecret: string | null;
	secretInHeader: boolean;
	resource: string | null;
	scopes: readonly string[];
	accessToken: string;
	refreshToken: string | null;
	expiresAt: number | null;
}>;

type SignInServer = Readonly<{
	issuer: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	registrationEndpoint: string;
	resource: string | null;
}>;

type Client = Pick<Grant, 'clientId' | 'clientSecret' | 'secretInHeader'>;

type GrantBase = Client & Pick<Grant, 'tokenEndpoint' | 'resource'>;

type Callback = Readonly<{ code: string; issuer: string | null }>;

export async function findSignIn(api: string, fetch: Fetch): Promise<SignInServer> {
	const { origin } = new URL(api);
	const site = widgetSite(api);
	const described = await metadata(`${origin}/.well-known/oauth-protected-resource`, fetch);
	const resource = text(described?.['resource']);
	if (resource !== null && URL.parse(resource)?.origin !== origin) throw noSignIn(site);
	const servers = described?.['authorization_servers'];
	const issuer = (Array.isArray(servers) ? text(servers[0]) : null) ?? origin;
	const server = await serverMetadata(issuer, fetch);
	const methods = server?.['code_challenge_methods_supported'];
	const endpoints = {
		authorizationEndpoint: secureUrl(server?.['authorization_endpoint']),
		tokenEndpoint: secureUrl(server?.['token_endpoint']),
		registrationEndpoint: secureUrl(server?.['registration_endpoint']),
	};
	if (
		endpoints.authorizationEndpoint === null ||
		endpoints.tokenEndpoint === null ||
		endpoints.registrationEndpoint === null ||
		(Array.isArray(methods) && !methods.includes('S256'))
	) {
		throw noSignIn(site);
	}
	return {
		issuer,
		authorizationEndpoint: endpoints.authorizationEndpoint,
		tokenEndpoint: endpoints.tokenEndpoint,
		registrationEndpoint: endpoints.registrationEndpoint,
		resource,
	};
}

export async function signIn(
	api: string,
	scopes: readonly string[],
	deps: OAuthDeps,
	signal: AbortSignal,
): Promise<Grant> {
	const site = widgetSite(api);
	const server = await findSignIn(api, deps.fetch);
	const state = randomValue();
	const verifier = randomValue();
	const listener = await listenForCallback(state, site, signal);
	try {
		const client = await register(server, listener.redirectUri, scopes, site, deps.fetch);
		const authorize = new URL(server.authorizationEndpoint);
		for (const [name, value] of Object.entries({
			response_type: 'code',
			client_id: client.clientId,
			redirect_uri: listener.redirectUri,
			state,
			code_challenge: createHash('sha256').update(verifier).digest('base64url'),
			code_challenge_method: 'S256',
			...(scopes.length === 0 ? {} : { scope: scopes.join(' ') }),
			...(server.resource === null ? {} : { resource: server.resource }),
		})) {
			authorize.searchParams.set(name, value);
		}
		if (signal.aborted) throw cancelled();
		await deps.openExternal(authorize.href);
		const callback = await listener.result;
		if (callback.issuer !== null && trimmed(callback.issuer) !== trimmed(server.issuer)) {
			throw failed(`${site} sent the sign-in back from another server.`);
		}
		const body = {
			grant_type: 'authorization_code',
			code: callback.code,
			redirect_uri: listener.redirectUri,
			code_verifier: verifier,
			...(server.resource === null ? {} : { resource: server.resource }),
		};
		const answer = await tokenRequest(server.tokenEndpoint, client, body, site, deps.fetch);
		const base = { ...client, tokenEndpoint: server.tokenEndpoint, resource: server.resource };
		return granted(answer, base, scopes, null, site);
	} finally {
		listener.close();
	}
}

export async function refreshGrant(grant: Grant, site: string, fetch: Fetch): Promise<Grant> {
	if (grant.refreshToken === null) throw signedOut(site);
	const answer = await tokenRequest(
		grant.tokenEndpoint,
		grant,
		{
			grant_type: 'refresh_token',
			refresh_token: grant.refreshToken,
			...(grant.resource === null ? {} : { resource: grant.resource }),
		},
		site,
		fetch,
	);
	return granted(answer, grant, grant.scopes, grant.refreshToken, site);
}

export function isFresh(grant: Grant, now = Date.now()): boolean {
	return grant.expiresAt === null || grant.expiresAt - EXPIRY_MARGIN_MS > now;
}

export function covers(grant: Grant, scopes: readonly string[]): boolean {
	return scopes.every((scope) => grant.scopes.includes(scope));
}

export function parseGrant(value: unknown): Grant | null {
	if (!isRecord(value)) return null;
	const {
		tokenEndpoint,
		clientId,
		clientSecret,
		secretInHeader,
		resource,
		scopes,
		accessToken,
		refreshToken,
		expiresAt,
	} = value;
	if (
		typeof tokenEndpoint !== 'string' ||
		typeof clientId !== 'string' ||
		typeof accessToken !== 'string' ||
		typeof secretInHeader !== 'boolean' ||
		!Array.isArray(scopes) ||
		!scopes.every((scope) => typeof scope === 'string')
	) {
		return null;
	}
	return {
		tokenEndpoint,
		clientId,
		clientSecret: typeof clientSecret === 'string' ? clientSecret : null,
		secretInHeader,
		resource: typeof resource === 'string' ? resource : null,
		scopes,
		accessToken,
		refreshToken: typeof refreshToken === 'string' ? refreshToken : null,
		expiresAt: typeof expiresAt === 'number' ? expiresAt : null,
	};
}

async function serverMetadata(
	issuer: string,
	fetch: Fetch,
): Promise<Readonly<Record<string, unknown>> | null> {
	const url = URL.parse(issuer);
	if (url === null || secureUrl(issuer) === null) return null;
	const path = url.pathname.replace(/\/$/u, '');
	for (const known of ['oauth-authorization-server', 'openid-configuration']) {
		const found = await metadata(`${url.origin}/.well-known/${known}${path}`, fetch);
		if (found !== null && trimmed(text(found['issuer']) ?? '') === trimmed(issuer)) return found;
	}
	return null;
}

async function metadata(
	url: string,
	fetch: Fetch,
): Promise<Readonly<Record<string, unknown>> | null> {
	try {
		const response = await fetch(url, {
			headers: { accept: 'application/json' },
			redirect: 'error',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const body = await jsonOf(response);
		return response.ok && isRecord(body) ? body : null;
	} catch {
		return null;
	}
}

async function register(
	server: SignInServer,
	redirectUri: string,
	scopes: readonly string[],
	site: string,
	fetch: Fetch,
): Promise<Client> {
	const response = await call(
		fetch,
		server.registrationEndpoint,
		{
			method: 'POST',
			headers: { accept: 'application/json', 'content-type': 'application/json' },
			body: JSON.stringify({
				client_name: 'Malini',
				redirect_uris: [redirectUri],
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none',
				...(scopes.length === 0 ? {} : { scope: scopes.join(' ') }),
			}),
		},
		site,
	);
	const body = await jsonOf(response);
	const clientId = isRecord(body) ? text(body['client_id']) : null;
	if (!response.ok || !isRecord(body) || clientId === null) {
		throw failed(`${site} did not let Malini register (${errorCode(body) ?? response.status}).`);
	}
	return {
		clientId,
		clientSecret: text(body['client_secret']),
		secretInHeader: body['token_endpoint_auth_method'] === 'client_secret_basic',
	};
}

async function tokenRequest(
	endpoint: string,
	client: Client,
	fields: Readonly<Record<string, string>>,
	site: string,
	fetch: Fetch,
): Promise<Readonly<Record<string, unknown>>> {
	const headers = new Headers({
		accept: 'application/json',
		'content-type': 'application/x-www-form-urlencoded',
	});
	const form = new URLSearchParams(fields);
	if (client.clientSecret !== null && client.secretInHeader) {
		const pair = `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`;
		headers.set('authorization', `Basic ${Buffer.from(pair).toString('base64')}`);
	} else {
		form.set('client_id', client.clientId);
		if (client.clientSecret !== null) form.set('client_secret', client.clientSecret);
	}
	const response = await call(fetch, endpoint, { method: 'POST', headers, body: form }, site);
	const body = await jsonOf(response);
	const code = errorCode(body);
	if (fields['grant_type'] === 'refresh_token' && code !== null && SIGNED_OUT_CODES.has(code)) {
		throw signedOut(site);
	}
	if (!response.ok || !isRecord(body)) {
		throw failed(`${site} turned down the sign-in (${code ?? response.status}).`);
	}
	return body;
}

function granted(
	answer: Readonly<Record<string, unknown>>,
	base: GrantBase,
	asked: readonly string[],
	refreshToken: string | null,
	site: string,
): Grant {
	const accessToken = text(answer['access_token']);
	const type = text(answer['token_type']);
	if (accessToken === null || (type !== null && type.toLowerCase() !== 'bearer')) {
		throw failed(`${site} sent no token Malini can use.`);
	}
	const seconds = answer['expires_in'];
	const scope = text(answer['scope']);
	return {
		tokenEndpoint: base.tokenEndpoint,
		clientId: base.clientId,
		clientSecret: base.clientSecret,
		secretInHeader: base.secretInHeader,
		resource: base.resource,
		scopes: scope === null ? asked : scope.split(' ').filter(Boolean),
		accessToken,
		refreshToken: text(answer['refresh_token']) ?? refreshToken,
		expiresAt:
			typeof seconds === 'number' && Number.isFinite(seconds) ? Date.now() + seconds * 1000 : null,
	};
}

async function call(fetch: Fetch, url: string, init: RequestInit, site: string): Promise<Response> {
	try {
		return await fetch(url, {
			...init,
			redirect: 'error',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw failed(`Malini could not reach ${site} to sign in.`);
	}
}

async function jsonOf(response: Response): Promise<unknown> {
	try {
		return JSON.parse((await readBounded(response, ANSWER_MAX_BYTES)).toString('utf8'));
	} catch {
		return null;
	}
}

type CallbackListener = Readonly<{
	result: Promise<Callback>;
	redirectUri: string;
	close(): void;
}>;

const RETURN_PAGE =
	'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>Back to Malini</title><style>body{font:16px system-ui;max-width:32rem;margin:18vh auto;padding:24px}h1{font-size:24px}</style><h1>Back to Malini</h1><p>You can close this tab.</p></html>';

async function listenForCallback(
	state: string,
	site: string,
	signal: AbortSignal,
): Promise<CallbackListener> {
	let finish: (value: Callback | Error) => void = () => undefined;
	let settled = false;
	const result = new Promise<Callback>((resolve, reject) => {
		finish = (value) => {
			if (settled) return;
			settled = true;
			if (value instanceof Error) reject(value);
			else resolve(value);
		};
	});
	void result.catch(() => undefined);
	let port = 0;
	const handler: RequestListener = (request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('Referrer-Policy', 'no-referrer');
		response.setHeader(
			'Content-Security-Policy',
			"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
		);
		const origin = `http://127.0.0.1:${port}`;
		const url = URL.parse(request.url ?? '/', origin);
		if (
			request.method !== 'GET' ||
			request.headers.host !== `127.0.0.1:${port}` ||
			url?.pathname !== CALLBACK_PATH ||
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
		const codes = url.searchParams.getAll('code');
		const [code] = codes;
		if (error === 'access_denied') finish(denied(site));
		else if (error !== null || code === undefined || codes.length !== 1) {
			finish(failed(`${site} turned down the sign-in (${safeCode(error ?? '') ?? 'no code'}).`));
		} else finish({ code, issuer: url.searchParams.get('iss') });
	};
	const server = createServer(handler);
	server.requestTimeout = 15_000;
	server.headersTimeout = 10_000;
	const close = (): void => {
		signal.removeEventListener('abort', abort);
		server.close();
		server.closeAllConnections();
	};
	const abort = (): void => {
		finish(cancelled());
		close();
	};
	await new Promise<void>((done, fail) => {
		server.once('error', fail);
		server.listen({ port: 0, host: '127.0.0.1' }, () => {
			server.removeListener('error', fail);
			const address = server.address();
			if (address && typeof address !== 'string') port = address.port;
			done();
		});
	});
	server.on('error', () => finish(failed('The sign-in listener stopped. Connect again.')));
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

function secureUrl(value: unknown): string | null {
	const url = typeof value === 'string' ? URL.parse(value) : null;
	const secure =
		url?.protocol === 'https:' || (url?.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
	return url !== null && secure && url.username === '' && url.password === '' ? url.href : null;
}

function errorCode(body: unknown): string | null {
	return isRecord(body) && typeof body['error'] === 'string' ? safeCode(body['error']) : null;
}

function safeCode(value: string): string | null {
	return /^[\w.:-]{1,100}$/u.test(value) ? value : null;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function trimmed(url: string): string {
	return url.replace(/\/+$/u, '');
}

function randomValue(): string {
	return randomBytes(32).toString('base64url');
}

function noSignIn(site: string): WidgetError {
	return new WidgetError('no-sign-in', `${site} has no sign-in Malini can use.`);
}

function denied(site: string): WidgetError {
	return new WidgetError('sign-in-denied', `${site} said no. Nothing was read.`);
}

function signedOut(site: string): WidgetError {
	return new WidgetError('signed-out', `${site} ended the sign-in.`);
}

function cancelled(): WidgetError {
	return new WidgetError('sign-in-cancelled', 'The sign-in was cancelled.');
}

function failed(message: string): WidgetError {
	return new WidgetError('sign-in-failed', message);
}
