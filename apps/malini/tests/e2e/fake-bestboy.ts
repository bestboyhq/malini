import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync, gzipSync } from 'node:zlib';
import { expect } from '@playwright/test';
import { openedUrls, type LaunchedApp } from './harness';

export type PlatformRequest = Readonly<{
	method: string;
	path: string;
	body: unknown;
	authorization: string | null;
	contentType: string | null;
}>;

export type ExtensionFile = Readonly<{ path: string; text: string }>;

export type FakeBestboy = Readonly<{
	origin: string;
	requests: PlatformRequest[];
	expectChallenge(challenge: string): void;
	refuseNextStatsUpload(): void;
	listExtension(files: readonly ExtensionFile[]): void;
	yankExtension(publisher: string, name: string, version: string): void;
	close(): void;
}>;

type Listing = Readonly<Record<string, unknown>> & {
	readonly publisher: string;
	readonly name: string;
	readonly version: string;
};

type Listed = Readonly<{ listing: Listing; bytes: Buffer; readme: string | null }>;

export function extensionPackage(files: readonly ExtensionFile[]): Buffer {
	return gzipSync(
		JSON.stringify({
			format: 1,
			files: files.map(({ path, text }) => ({
				path,
				data: Buffer.from(text).toString('base64'),
			})),
		}),
	);
}

export async function signInUrl(
	app: LaunchedApp,
	platform: FakeBestboy,
	count: number,
): Promise<Readonly<{ state: string }>> {
	await expect.poll(async () => (await openedUrls(app)).length).toBe(count);
	const opened = new URL((await openedUrls(app)).at(-1) ?? '');
	expect(`${opened.origin}${opened.pathname}`).toBe(`${platform.origin}/login`);
	expect(opened.searchParams.get('app')).toBe('malini');
	const challenge = opened.searchParams.get('challenge') ?? '';
	const state = opened.searchParams.get('state') ?? '';
	expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
	expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/u);
	platform.expectChallenge(challenge);
	return { state };
}

export async function openUrl(app: LaunchedApp, url: string): Promise<void> {
	await app.electronApp.evaluate(({ app: electron }, callback) => {
		electron.emit('open-url', { preventDefault: () => undefined }, callback);
	}, url);
}

export async function fakeBestboy(): Promise<FakeBestboy> {
	const requests: PlatformRequest[] = [];
	const listed = new Map<string, Listed>();
	const yanked: { publisher: string; name: string; version: string }[] = [];
	let challenge = '';
	let tokens = 0;
	let refuseStats = false;
	const revoked = new Set<string>();
	let profile: { handle: string | null; public: boolean } = { handle: null, public: false };

	const list = (bytes: Buffer): Listing => {
		const files = unpacked(bytes);
		const manifest = JSON.parse(files.get('malini.json') ?? '{}') as {
			publisher: string;
			name: string;
			version: string;
			displayName: string;
			description: string;
			repository?: string;
			contributes?: { mcpServers?: Record<string, { url: string }> };
		};
		const listing: Listing = {
			publisher: manifest.publisher,
			name: manifest.name,
			displayName: manifest.displayName,
			description: manifest.description,
			version: manifest.version,
			publishedOn: '2026-10-31',
			repository: manifest.repository ?? null,
			mcpServers: Object.entries(manifest.contributes?.mcpServers ?? {}).map(([name, server]) => ({
				name,
				url: server.url,
			})),
			skills: [
				...new Set(
					[...files.keys()].flatMap((path) => /^skills\/([^/]+)\//u.exec(path)?.[1] ?? []),
				),
			].sort(),
			package: {
				sha256: createHash('sha256').update(bytes).digest('hex'),
				size: bytes.length,
			},
		};
		listed.set(`${manifest.publisher}/${manifest.name}`, {
			listing,
			bytes,
			readme: files.get('README.md') ?? null,
		});
		return listing;
	};

	const server = createServer((request, response) => {
		void (async () => {
			const url = new URL(request.url ?? '/', 'http://localhost');
			const raw = await rawBody(request);
			const contentType = request.headers['content-type'] ?? null;
			const body =
				contentType === 'application/json' && raw.length > 0 ? JSON.parse(String(raw)) : null;
			const authorization = request.headers.authorization ?? null;
			requests.push({
				method: request.method ?? '',
				path: url.pathname,
				body,
				authorization,
				contentType,
			});
			const reply = (status: number, value?: unknown, headers = {}): void => {
				response.writeHead(status, { 'content-type': 'application/json', ...headers });
				response.end(value === undefined ? '' : JSON.stringify(value));
			};
			const profileReply = (): unknown => ({
				...profile,
				url: profile.handle ? `${origin}/@${profile.handle}` : null,
			});
			const route = `${request.method} ${url.pathname}`;
			if (route === 'GET /api/extensions') {
				reply(
					200,
					{ extensions: [...listed.values()].map((entry) => entry.listing), yanked },
					{ 'cache-control': 'public, max-age=300' },
				);
				return;
			}
			const media = /^\/media\/extensions\/([^/]+)\/([^/]+)\/[^/]+\.malini$/u.exec(url.pathname);
			if (request.method === 'GET' && media) {
				const entry = listed.get(`${media[1]}/${media[2]}`);
				response.writeHead(entry ? 200 : 404, { 'content-type': 'application/gzip' });
				response.end(entry?.bytes ?? '');
				return;
			}
			const packageRoute =
				/^\/api\/extensions\/([^/]+)\/([^/]+)\/versions\/([^/]+)\/package$/u.exec(url.pathname);
			if (request.method === 'GET' && packageRoute) {
				const [, publisher, name, version] = packageRoute;
				response.writeHead(302, {
					location: `${origin}/media/extensions/${publisher}/${name}/${version}.malini`,
				});
				response.end();
				return;
			}
			const detail = /^\/api\/extensions\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
			if (request.method === 'GET' && detail) {
				const entry = listed.get(`${detail[1]}/${detail[2]}`);
				if (!entry) {
					reply(404, { error: 'No such extension.' });
					return;
				}
				reply(200, {
					...entry.listing,
					readme: entry.readme,
					versions: [{ version: entry.listing.version, publishedOn: '2026-10-31', yanked: false }],
				});
				return;
			}
			if (route === 'POST /api/auth/token') {
				const verifier = typeof body === 'object' && body ? Reflect.get(body, 'verifier') : null;
				const code = typeof body === 'object' && body ? Reflect.get(body, 'code') : null;
				const hashed =
					typeof verifier === 'string'
						? createHash('sha256').update(verifier).digest('base64url')
						: '';
				if (code !== 'e2e-code' || hashed !== challenge) {
					reply(400, { error: 'That sign-in code does not work.' });
					return;
				}
				tokens += 1;
				reply(200, { token: `e2e-token-${tokens}`, user: { name: 'E2E Person' }, team: {} });
				return;
			}
			if (
				authorization === null ||
				revoked.has(authorization) ||
				authorization !== `Bearer e2e-token-${tokens}`
			) {
				reply(401, { error: 'Sign in again.' });
				return;
			}
			if (route === 'GET /api/me') {
				reply(200, {
					user: { id: 'u1', email: 'e2e@bestboy.dev', name: 'E2E Person', avatar: null },
					team: { id: 't1', name: 'E2E', plan: 'early' },
					profile: profileReply(),
				});
				return;
			}
			if (route === 'PUT /api/profile') {
				const handle = typeof body === 'object' && body ? Reflect.get(body, 'handle') : undefined;
				if (handle === 'taken') {
					reply(409, { error: 'Someone else has that handle.', field: 'handle' });
					return;
				}
				const shown = typeof body === 'object' && body ? Reflect.get(body, 'public') : undefined;
				profile = {
					handle: typeof handle === 'string' ? handle : profile.handle,
					public: typeof shown === 'boolean' ? shown : profile.public,
				};
				reply(200, profileReply());
				return;
			}
			const publish = /^\/api\/extensions\/([^/]+)\/([^/]+)\/versions$/u.exec(url.pathname);
			if (request.method === 'POST' && publish) {
				if (publish[1] !== profile.handle) {
					reply(403, { error: 'You publish under your own handle.' });
					return;
				}
				reply(201, list(raw));
				return;
			}
			if (route === 'PUT /api/stats/malini' && refuseStats) {
				refuseStats = false;
				revoked.add(authorization);
				reply(401, { error: 'Sign in again.' });
				return;
			}
			if (route === 'PUT /api/stats/malini' || route === 'DELETE /api/stats/malini') {
				reply(204);
				return;
			}
			if (route === 'POST /api/auth/logout') {
				reply(204);
				return;
			}
			reply(404, { error: 'Not found.' });
		})();
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	return {
		origin,
		requests,
		expectChallenge: (next) => {
			challenge = next;
		},
		refuseNextStatsUpload: () => {
			refuseStats = true;
		},
		listExtension: (files) => {
			list(extensionPackage(files));
		},
		yankExtension: (publisher, name, version) => {
			yanked.push({ publisher, name, version });
			if (listed.get(`${publisher}/${name}`)?.listing.version === version) {
				listed.delete(`${publisher}/${name}`);
			}
		},
		close: () => server.close(),
	};
}

function unpacked(bytes: Buffer): Map<string, string> {
	const parsed = JSON.parse(String(gunzipSync(bytes))) as {
		files: { path: string; data: string }[];
	};
	return new Map(
		parsed.files.map(({ path, data }) => [path, Buffer.from(data, 'base64').toString('utf8')]),
	);
}

async function rawBody(request: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}
