import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '$contract/commands';
import { parseWidgetData, type WidgetBoard, type WidgetReading } from '$contract/widgets';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { all, canonicalJson } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import type { GhResult } from '$main/process/gh';
import { createNodeProcessRunner } from '$main/process/runner';
import {
	getWorkstream,
	upsertProject,
	upsertWorkstream,
} from '$shared/repositories/repositories.platform';
import { registerWidgets, type WidgetsPlatform } from './register';
import { mineHome, storeRoot } from './widget-store';
import { placeWidget, recordRead } from './widgets.repository';

const NOW = '2026-11-22T00:00:00.000Z';
const WORKSTREAM = 'ws-1';
const BOARD = 'bestboyhq/malini';
const ORIGIN = 'https://github.com/bestboyhq/malini.git';
const SLOW = { timeout: 10_000 };

let context: MainContext;
let scratch: string;
let base: string;
let checkout: string;
let widgets: WidgetsPlatform;
let ghAnswer: (args: readonly string[]) => GhResult;
const gh = vi.fn(async (args: readonly string[], _options?: { cwd?: string; timeoutMs?: number }) =>
	ghAnswer(args),
);
type Asked = Readonly<{ method: string; path: string; headers: IncomingHttpHeaders; body: string }>;
type Answer = Readonly<{ status: number; body: string; location?: string }>;
let api: Api;
let asked: Asked[];
let answer: (asked: Asked) => Answer;
let opened: string[];
let browse: (url: string) => Promise<void>;
const log = vi.fn((_line: string) => undefined);

beforeEach(async () => {
	asked = [];
	opened = [];
	browse = followSignIn;
	answer = () => ROOMS;
	api = await listen();
	scratch = mkdtempSync(join(tmpdir(), 'malini-widgets-'));
	base = repository('base');
	checkout = repository('checkout');
	context = {
		db: openMigratedDatabase(':memory:'),
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: join(scratch, 'app-data'),
		checkoutsRoot: scratch,
		resourcesRoot: scratch,
		isDev: false,
		appVersion: '0.0.0',
	};
	signedIn('szymeo');
	upsertProject(context.db, {
		id: 'project',
		name: 'malini',
		repoPath: base,
		defaultBranch: 'main',
		createdAt: NOW,
	});
	startWorkstream(WORKSTREAM, checkout);
	ghAnswer = () => ({ stdout: JSON.stringify({ value: 7, caption: 'runs' }), stderr: '', code: 0 });
	gh.mockClear();
	log.mockClear();
	widgets = register();
});

afterEach(async () => {
	widgets.dispose();
	await api.close();
	context.db.close();
	rmSync(scratch, { recursive: true, force: true });
});

type SignIn = {
	discover: boolean;
	deny: boolean;
	revoked: boolean;
	expiresIn: number;
	issued: number;
	challenge: string | null;
	registered: unknown[];
	authorized: URLSearchParams[];
	tokens: URLSearchParams[];
};

type Api = Readonly<{ url: string; site: string; signIn: SignIn; close: () => Promise<void> }>;

const ROOMS: Answer = { status: 200, body: JSON.stringify({ rooms: 4, region: 'eu' }) };

async function listen(): Promise<Api> {
	const signIn: SignIn = {
		discover: true,
		deny: false,
		revoked: false,
		expiresIn: 3600,
		issued: 0,
		challenge: null,
		registered: [],
		authorized: [],
		tokens: [],
	};
	let url = '';
	const server: Server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			const seen = {
				method: request.method ?? '',
				path: request.url ?? '',
				headers: request.headers,
				body: Buffer.concat(chunks).toString('utf8'),
			};
			const signingIn = signInAnswer(seen, url, signIn);
			if (signingIn === null) asked.push(seen);
			const { status, body, location } = signingIn ?? answer(seen);
			response.writeHead(status, location === undefined ? {} : { location });
			response.end(body);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('no port');
	const site = `127.0.0.1:${address.port}`;
	url = `http://${site}`;
	return {
		url,
		site,
		signIn,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

function signInAnswer(seen: Asked, url: string, signIn: SignIn): Answer | null {
	const { pathname, searchParams } = new URL(seen.path, url);
	const json = (body: unknown, status = 200): Answer => ({ status, body: JSON.stringify(body) });
	if (pathname.startsWith('/.well-known/')) {
		if (signIn.discover && pathname === '/.well-known/oauth-protected-resource') {
			return json({ resource: url, authorization_servers: [url] });
		}
		if (signIn.discover && pathname === '/.well-known/oauth-authorization-server') {
			return json({
				issuer: url,
				authorization_endpoint: `${url}/authorize`,
				token_endpoint: `${url}/token`,
				registration_endpoint: `${url}/register`,
				code_challenge_methods_supported: ['S256'],
			});
		}
		return { status: 404, body: '' };
	}
	if (pathname === '/register') {
		signIn.registered.push(JSON.parse(seen.body));
		return json({ client_id: 'malini-client' }, 201);
	}
	if (pathname === '/authorize') {
		signIn.authorized.push(searchParams);
		signIn.challenge = searchParams.get('code_challenge');
		const back = new URL(searchParams.get('redirect_uri') ?? '');
		back.searchParams.set('state', searchParams.get('state') ?? '');
		if (signIn.deny) back.searchParams.set('error', 'access_denied');
		else {
			back.searchParams.set('code', 'code-1');
			back.searchParams.set('iss', url);
		}
		return { status: 302, body: '', location: back.href };
	}
	if (pathname !== '/token') return null;
	const form = new URLSearchParams(seen.body);
	signIn.tokens.push(form);
	const verifier = form.get('code_verifier') ?? '';
	const refused =
		form.get('grant_type') === 'refresh_token'
			? signIn.revoked || form.get('refresh_token') !== 'refresh-1'
			: form.get('code') !== 'code-1' ||
				createHash('sha256').update(verifier).digest('base64url') !== signIn.challenge;
	if (refused) return json({ error: 'invalid_grant' }, 400);
	signIn.issued += 1;
	return json({
		access_token: `token-${signIn.issued}`,
		token_type: 'Bearer',
		expires_in: signIn.expiresIn,
		refresh_token: 'refresh-1',
		scope: 'query:read',
	});
}

async function followSignIn(url: string): Promise<void> {
	const authorized = await fetch(url, { redirect: 'manual' });
	const back = authorized.headers.get('location');
	if (back !== null) await (await fetch(back)).text();
}

function repository(name: string): string {
	const path = join(scratch, name);
	execFileSync('git', ['init', '-q', '-b', 'main', path]);
	git(path, 'remote', 'add', 'origin', ORIGIN);
	return path;
}

function git(path: string, ...args: string[]): void {
	execFileSync('git', ['-C', path, ...args]);
}

function signedIn(login: string | null): void {
	context.commands.define('repositories.github-auth-status', async () => ({
		authenticated: login !== null,
		installed: true,
		login,
		host: 'github.com',
		message: login === null ? 'Not signed in' : null,
	}));
}

function startWorkstream(id: string, path: string): void {
	upsertWorkstream(context.db, {
		id,
		projectId: 'project',
		name: id,
		path,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
		startedBy: null,
	});
}

function register(deps: Readonly<{ sharedCheckMs?: number }> = {}): WidgetsPlatform {
	return registerWidgets(context, {
		checkouts: { resolveCheckout: async (id) => getWorkstream(context.db, id)?.path ?? checkout },
		gh,
		runner: createNodeProcessRunner(),
		environment: () => ({ PATH: process.env['PATH'] ?? '/usr/bin:/bin', SHELL: '/bin/sh' }),
		fetch: (url, init) => fetch(url, init),
		openExternal: async (url) => {
			opened.push(url);
			await browse(url);
		},
		sealer: SEALER,
		log,
		eventDebounceMs: 10,
		...deps,
	});
}

function restart(login: string | null, deps: Readonly<{ sharedCheckMs?: number }> = {}): void {
	widgets.dispose();
	context = { ...context, commands: new CommandRegistry() };
	signedIn(login);
	widgets = register(deps);
}

function publish(files: Readonly<Record<string, unknown>>): void {
	const folder = join(base, '.malini', 'widgets');
	rmSync(folder, { recursive: true, force: true });
	mkdirSync(folder, { recursive: true });
	for (const [name, file] of Object.entries(files)) {
		writeFileSync(join(folder, name), typeof file === 'string' ? file : JSON.stringify(file));
	}
	git(base, 'add', '-A');
	git(
		base,
		'-c',
		'user.name=Test',
		'-c',
		'user.email=widgets',
		'-c',
		'commit.gpgsign=false',
		'commit',
		'-q',
		'--no-verify',
		'--allow-empty',
		'-m',
		'widgets',
	);
	git(base, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
}

function checkoutFile(name: string, text: string): void {
	mkdirSync(join(checkout, '.malini', 'widgets'), { recursive: true });
	writeFileSync(join(checkout, '.malini', 'widgets', name), text);
}

function home(id: string): string {
	return mineHome(storeRoot(context.appDataRoot, BOARD), id);
}

function call<Name extends CommandName>(
	command: Name,
	args: Record<string, unknown>,
): Promise<unknown> {
	return context.commands.invoke({ command, args });
}

function board(): Promise<WidgetBoard> {
	return context.commands.call('widgets.board', { workstreamId: WORKSTREAM });
}

function place(widgetId: string, index = 0): Promise<WidgetBoard> {
	return context.commands.call('widgets.place', { workstreamId: WORKSTREAM, widgetId, index });
}

function remove(widgetId: string): Promise<WidgetBoard> {
	return context.commands.call('widgets.remove', { workstreamId: WORKSTREAM, widgetId });
}

function watch(watching: boolean): Promise<void> {
	return context.commands.call('widgets.watch', { workstreamId: WORKSTREAM, watching });
}

async function order(): Promise<Array<[string, string]>> {
	return (await board()).placements.map(({ widgetId, span }) => [
		widgetId,
		`${span.columns}x${span.rows}`,
	]);
}

const DEPLOY = {
	title: 'Deploy',
	icon: 'route',
	source: { github: 'repos/{owner}/{repo}/actions/runs?per_page=12', select: '{value: 1}' },
	refresh: { every: 5, on: ['repositories:changed', 'nope:never', 'widgets:board-changed'] },
	url: 'https://github.com/bestboyhq/malini/actions',
	author: 'aleksander',
};

const DEPLOY_SAVED = {
	...DEPLOY,
	id: 'deploy',
	refresh: { every: 5, on: ['repositories:changed'] },
};

const SEALER = {
	isEncryptionAvailable: () => true,
	encryptString: (plainText: string) => Buffer.from([...plainText].reverse().join('')),
	decryptString: (encrypted: Buffer) => [...encrypted.toString()].reverse().join(''),
};

function rooms(
	at: Api = api,
	signsIn = true,
): Readonly<{ title: string; source: Readonly<Record<string, unknown>> }> {
	return {
		title: 'Rooms',
		source: {
			http: {
				url: `${at.url}/api/projects/1/query/`,
				method: 'POST',
				body: { query: { kind: 'TrendsQuery' } },
				...(signsIn ? { oauth: { scopes: ['query:read'] } } : {}),
			},
			select: '{value: .rooms, caption: .region}',
		},
	};
}

function credentialed(url: string): string {
	const parsed = new URL(url);
	parsed.username = 'me';
	return parsed.href;
}

function connect(widgetId: string): Promise<void> {
	return context.commands.call('widgets.connect', { workstreamId: WORKSTREAM, widgetId });
}

async function reading(widgetId: string): Promise<WidgetReading | undefined> {
	return (await board()).readings.find((each) => each.widgetId === widgetId);
}

function connected(): Array<Readonly<{ origin: string; sealed: Uint8Array }>> {
	return all(context.db, 'SELECT origin, sealed FROM widget_connections');
}

describe('saving a widget', () => {
	it('keeps it in your own store, places it first, and reads it once', async () => {
		const input = {
			title: 'Deploy runs',
			source: { github: 'repos/{owner}/{repo}/actions/runs', select: '{value: 1}' },
			refresh: { every: 120, on: ['pull-requests:ship-changed'] },
		};
		const changed = vi.fn();
		context.events.subscribe('widgets:board-changed', changed);

		const saved = await widgets.save(WORKSTREAM, input);
		expect(saved.widget).toMatchObject({ id: 'deploy-runs', author: 'szymeo', origin: 'mine' });
		expect(saved.reading.data).toMatchObject({ value: 7 });
		expect(changed).toHaveBeenCalledWith({ board: BOARD });
		expect(
			readFileSync(join(home('deploy-runs'), '.malini/widgets/deploy-runs.json'), 'utf8'),
		).toBe(
			`${JSON.stringify(
				{
					title: 'Deploy runs',
					scope: 'shared',
					source: { github: 'repos/{owner}/{repo}/actions/runs', select: '{value: 1}' },
					refresh: { every: 120, on: ['pull-requests:ship-changed'] },
					author: 'szymeo',
				},
				null,
				'\t',
			)}\n`,
		);
		expect(existsSync(join(checkout, '.malini'))).toBe(false);

		expect((await widgets.save(WORKSTREAM, input)).widget.id).toBe('deploy-runs-2');
		await widgets.save(WORKSTREAM, { ...input, id: 'deploy-runs', title: 'Deploys' });
		expect((await widgets.save(WORKSTREAM, { ...input, title: 'Plan' })).widget.id).toBe('plan-2');
		expect(await order()).toEqual([
			['plan-2', '2x1'],
			['deploy-runs-2', '2x1'],
			['deploy-runs', '2x1'],
			['plan', '12x2'],
		]);
		expect((await board()).widgets.find(({ id }) => id === 'deploy-runs')?.title).toBe('Deploys');
	});

	it('reads an API as you once you connect, and turns its answer into data with jq', async () => {
		const saved = await widgets.save(WORKSTREAM, rooms());
		expect(saved.widget.source).toMatchObject({
			kind: 'http',
			method: 'POST',
			oauth: { scopes: ['query:read'] },
		});
		expect(saved.reading).toMatchObject({
			data: null,
			need: { connect: api.site },
			error: `Reads ${api.site} as you.`,
		});
		expect(asked).toEqual([]);

		await connect('rooms');
		await vi.waitFor(async () =>
			expect(await reading('rooms')).toMatchObject({
				data: { value: 4, caption: 'eu' },
				need: null,
				error: null,
			}),
		);
		expect(asked).toEqual([
			expect.objectContaining({
				method: 'POST',
				path: '/api/projects/1/query/',
				headers: expect.objectContaining({
					authorization: 'Bearer token-1',
					'content-type': 'application/json',
				}),
				body: JSON.stringify({ query: { kind: 'TrendsQuery' } }),
			}),
		]);
		expect(api.signIn.registered).toEqual([
			expect.objectContaining({
				client_name: 'Malini',
				token_endpoint_auth_method: 'none',
				scope: 'query:read',
				redirect_uris: [expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/callback$/u)],
			}),
		]);
		expect(Object.fromEntries(api.signIn.authorized[0] ?? [])).toMatchObject({
			response_type: 'code',
			client_id: 'malini-client',
			code_challenge_method: 'S256',
			scope: 'query:read',
			resource: api.url,
		});
		expect(opened).toHaveLength(1);
		expect(connected().map(({ origin }) => origin)).toEqual([api.url]);
		expect(Buffer.from(connected()[0]?.sealed ?? []).toString()).not.toContain('token-1');
		expect(
			JSON.parse(readFileSync(join(home('rooms'), '.malini/widgets/rooms.json'), 'utf8')),
		).toMatchObject({ source: rooms().source });

		answer = () => ({ status: 200, body: '{"value": 5}' });
		const bare = { ...rooms(), id: 'rooms', source: { http: { url: `${api.url}/value` } } };
		expect((await widgets.save(WORKSTREAM, bare)).reading.data).toMatchObject({ value: 5 });
		expect(asked.at(-1)).toMatchObject({ method: 'GET', path: '/value', body: '' });
		expect(asked.at(-1)?.headers.authorization).toBeUndefined();

		const broken = { ...rooms(), id: 'rooms', source: { ...rooms().source, select: '{value: .[' } };
		expect((await widgets.save(WORKSTREAM, broken)).reading.error).toMatch(/^jq: /u);
	});

	it('sends a token only to the site that issued it, and reads every tile of that site once connected', async () => {
		const other = await listen();
		try {
			publish({ 'steal.json': { ...rooms(other), title: 'Steal' } });
			await widgets.save(WORKSTREAM, rooms());
			await widgets.save(WORKSTREAM, { ...rooms(), title: 'Rooms again' });
			await place('steal');
			await watch(true);
			await connect('rooms');
			await vi.waitFor(async () =>
				expect((await board()).readings).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ widgetId: 'rooms', data: expect.anything() }),
						expect.objectContaining({ widgetId: 'rooms-again', data: expect.anything() }),
						expect.objectContaining({
							widgetId: 'steal',
							data: null,
							need: { connect: other.site },
							error: `Reads ${other.site} as you.`,
						}),
					]),
				),
			);
			await watch(false);
			expect(asked.map(({ headers }) => [headers.host, headers.authorization])).toEqual([
				[api.site, 'Bearer token-1'],
				[api.site, 'Bearer token-1'],
			]);
			expect(api.signIn.registered).toHaveLength(1);
			expect(other.signIn.registered).toEqual([]);
		} finally {
			await other.close();
		}
	});

	it('refreshes a refused token once, masks it, and asks to connect again once the site ends the sign-in', async () => {
		answer = (seen) =>
			seen.headers.authorization === 'Bearer token-1'
				? { status: 401, body: '{"detail": "expired"}' }
				: ROOMS;
		await widgets.save(WORKSTREAM, rooms());
		await connect('rooms');
		await vi.waitFor(async () =>
			expect(await reading('rooms')).toMatchObject({ data: { value: 4 }, reading: false }),
		);
		expect(asked.map(({ headers }) => headers.authorization)).toEqual([
			'Bearer token-1',
			'Bearer token-2',
		]);
		expect(api.signIn.tokens.map((form) => form.get('grant_type'))).toEqual([
			'authorization_code',
			'refresh_token',
		]);

		answer = (seen) => ({
			status: 401,
			body: `{"detail": "${seen.headers.authorization ?? ''} is not valid"}`,
		});
		expect((await widgets.save(WORKSTREAM, { ...rooms(), id: 'rooms' })).reading).toMatchObject({
			need: null,
			error: `${api.site} answered 401. {"detail": "Bearer [secret] is not valid"}`,
		});
		expect(asked.at(-1)?.headers.authorization).toBe('Bearer token-3');

		api.signIn.revoked = true;
		expect((await widgets.save(WORKSTREAM, { ...rooms(), id: 'rooms' })).reading).toMatchObject({
			need: { connect: api.site },
			error: `${api.site} ended the sign-in.`,
		});
		expect(connected()).toEqual([]);
	});

	it('refreshes a token about to expire before it reads', async () => {
		api.signIn.expiresIn = 30;
		await widgets.save(WORKSTREAM, rooms());
		await connect('rooms');
		await vi.waitFor(async () =>
			expect(await reading('rooms')).toMatchObject({ data: { value: 4 }, reading: false }),
		);
		expect(asked.map(({ headers }) => headers.authorization)).toEqual(['Bearer token-2']);
	});

	it('turns down a site with no sign-in, and keeps a denied or cancelled sign-in on the tile', async () => {
		api.signIn.discover = false;
		await expect(widgets.save(WORKSTREAM, rooms())).rejects.toThrow(
			`${api.site} has no sign-in Malini can use. Drop \`oauth\``,
		);
		api.signIn.discover = true;
		await widgets.save(WORKSTREAM, rooms());

		api.signIn.deny = true;
		await connect('rooms');
		const denied = {
			need: { connect: api.site },
			error: `${api.site} said no. Nothing was read.`,
		};
		expect(await reading('rooms')).toMatchObject(denied);

		browse = async () => undefined;
		const waiting = connect('rooms');
		const joined = connect('rooms');
		await vi.waitFor(() => expect(opened).toHaveLength(2));
		await context.commands.call('widgets.cancel-connect', undefined);
		await Promise.all([waiting, joined]);
		expect(opened).toHaveLength(2);
		expect(await reading('rooms')).toMatchObject(denied);
		expect(asked).toEqual([]);
		expect(api.signIn.tokens).toEqual([]);
		expect(connected()).toEqual([]);
	});

	it('refuses a redirect and says when a site does not answer', async () => {
		const plain = rooms(api, false);
		answer = () => ({ status: 302, body: '', location: 'https://evil.dev/collect' });
		expect((await widgets.save(WORKSTREAM, plain)).reading.error).toBe(
			`${api.site} redirected the request. Save the address it redirects to.`,
		);
		await api.close();
		expect((await widgets.save(WORKSTREAM, { ...plain, id: 'rooms' })).reading.error).toMatch(
			new RegExp(`^${api.site} did not answer: `, 'u'),
		);
	});

	it('refuses a script or an MCP tool, and shows one from the default branch as a failed read', async () => {
		await expect(
			widgets.save(WORKSTREAM, { title: 'Flood', source: { command: 'yes' } }),
		).rejects.toThrow('not scripts or MCP tools');
		await expect(
			widgets.save(WORKSTREAM, {
				title: 'Trend',
				source: { mcp: { server: 'posthog', tool: 'query-trends', arguments: {} } },
			}),
		).rejects.toThrow('not scripts or MCP tools');
		publish({
			'rooms.json': { title: 'Rooms', source: { command: 'node rooms.mjs' } },
			'trend.json': {
				title: 'Trend',
				source: { mcp: { server: 'posthog', tool: 'query-trends', arguments: {} } },
			},
		});
		await place('rooms');
		await place('trend');
		const placed = await board();
		expect(placed.widgets.find(({ id }) => id === 'trend')?.source).toEqual({
			kind: 'retired',
			line: 'posthog · query-trends',
		});
		const fingerprint = placed.widgets.find(({ id }) => id === 'rooms')?.fingerprint ?? '';
		const old = parseWidgetData({ value: 82 });
		if (old === null) throw new Error('no data');
		recordRead(context.db, placed.board, 'rooms', fingerprint, old);
		await watch(true);
		const retired =
			'Widgets read APIs now, not scripts or MCP tools. Ask the agent to move this one.';
		await vi.waitFor(async () =>
			expect((await board()).readings).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ widgetId: 'rooms', data: null, error: retired }),
					expect.objectContaining({ widgetId: 'trend', data: null, error: retired }),
				]),
			),
		);
		await watch(false);
	});

	it('refuses a bad id, a missing title, an unknown channel and an id shared from the default branch', async () => {
		publish({ 'deploy.json': DEPLOY });
		const { source } = rooms();
		await expect(widgets.save(WORKSTREAM, { id: 'Bad', title: 'Bad', source })).rejects.toThrow(
			'kebab-case',
		);
		await expect(widgets.save(WORKSTREAM, { id: 'plan', title: 'Mine', source })).rejects.toThrow(
			'built-in',
		);
		await expect(widgets.save(WORKSTREAM, { source })).rejects.toThrow('title');
		await expect(
			widgets.save(WORKSTREAM, { title: 'Rooms', source, refresh: { on: ['deploys:done'] } }),
		).rejects.toMatchObject({ message: expect.stringContaining('deploys:done') });
		await expect(
			widgets.save(WORKSTREAM, { id: 'deploy', title: 'Deploy', source }),
		).rejects.toMatchObject({ kind: 'shared-widget' });
		expect((await board()).widgets.map(({ id, origin }) => [id, origin])).toEqual([
			['plan', 'plan'],
			['deploy', 'shared'],
		]);
		await expect(connect('deploy')).rejects.toThrow('signs in nowhere');
		const http = (request: Readonly<Record<string, unknown>>) =>
			widgets.save(WORKSTREAM, { title: 'Rooms', source: { http: request } });
		await expect(http({ url: 'http://us.posthog.com/api' })).rejects.toThrow('https address');
		await expect(http({ url: credentialed('https://us.posthog.com/api') })).rejects.toThrow(
			'https address',
		);
		await expect(http({ url: `${api.url}/x`, body: { a: 1 } })).rejects.toThrow('"method": "POST"');
		await expect(http({ url: `${api.url}/x`, method: 'DELETE' })).rejects.toThrow('method');
		await expect(
			http({ url: `${api.url}/x`, headers: { Authorization: 'Bearer phx_1' } }),
		).rejects.toThrow('carry no keys or tokens');
		await expect(http({ url: `${api.url}/x`, oauth: { scopes: 'query:read' } })).rejects.toThrow(
			'`source.http.oauth`',
		);
		expect(asked).toEqual([]);
	});
});

describe('the board', () => {
	it('reads shared widgets from the default branch strictly and skips each broken one once', async () => {
		publish({
			'deploy.json': DEPLOY,
			'rooms.json': { title: 'Rooms', scope: 'own', source: { command: 'node rooms.mjs' } },
			'broken.json': '{ not json',
			'Bad_Name.json': { title: 'Bad', source: { command: 'true' } },
			'escape.json': { title: 'Escape', source: { github: 'repos/../../user' } },
			'elsewhere.json': { title: 'Elsewhere', source: { github: 'https://evil.dev/x' } },
			'ftp.json': { title: 'Ftp', source: { command: 'true' }, url: 'ftp://x.dev' },
			'both.json': { title: 'Both', source: { command: 'true', github: 'user' } },
		});

		const first = await board();
		await board();

		expect(first.board).toBe(BOARD);
		expect(first.me).toBe('szymeo');
		expect(first.widgets.map(({ id }) => id)).toEqual(['plan', 'deploy', 'rooms']);
		const source = {
			kind: 'github',
			path: 'repos/{owner}/{repo}/actions/runs?per_page=12',
			select: '{value: 1}',
		};
		expect(first.widgets[1]).toEqual({
			id: 'deploy',
			title: 'Deploy',
			icon: 'route',
			scope: 'shared',
			source,
			refresh: { everySeconds: 15, on: ['repositories:changed'] },
			url: 'https://github.com/bestboyhq/malini/actions',
			author: 'aleksander',
			fingerprint: createHash('sha256').update(canonicalJson(source)).digest('hex'),
			origin: 'shared',
		});
		expect(first.widgets[2]).toMatchObject({
			scope: 'own',
			source: { kind: 'retired', line: 'Runs node rooms.mjs' },
			refresh: { everySeconds: 300, on: [] },
			origin: 'shared',
		});
		expect(first.placements).toEqual([{ widgetId: 'plan', span: { columns: 12, rows: 2 } }]);
		expect(log).toHaveBeenCalledTimes(6);
	});

	it('starts a board once with the plan placed large, and keeps it off once removed', async () => {
		expect(await order()).toEqual([['plan', '12x2']]);
		await remove('plan');
		expect(await order()).toEqual([]);
		expect((await board()).widgets.map(({ id }) => id)).toEqual(['plan']);
	});

	it('pins the plan before the other widgets of a repository board, once', async () => {
		const pin = (repositoryFullName: string) =>
			context.commands.call('widgets.pin-plan', { repositoryFullName });
		publish({ 'deploy.json': DEPLOY });
		await remove('plan');
		await place('deploy');
		await pin(BOARD);
		expect(await order()).toEqual([
			['plan', '12x2'],
			['deploy', '2x1'],
		]);
		await place('plan', 1);
		await pin(BOARD);
		expect(await order()).toEqual([
			['deploy', '2x1'],
			['plan', '12x2'],
		]);
		await expect(
			call('widgets.pin-plan', { repositoryFullName: 'not a repository' }),
		).resolves.toMatchObject({ ok: false, error: expect.stringContaining('repositoryFullName') });
	});

	it('places, moves and resizes widgets, and refuses bad arguments', async () => {
		publish({ 'deploy.json': DEPLOY });
		await widgets.save(WORKSTREAM, rooms());
		await place('deploy', 0);
		expect(await order()).toEqual([
			['deploy', '2x1'],
			['rooms', '2x1'],
			['plan', '12x2'],
		]);
		await place('deploy', 2);
		expect(await order()).toEqual([
			['rooms', '2x1'],
			['plan', '12x2'],
			['deploy', '2x1'],
		]);
		const resized = await context.commands.call('widgets.resize', {
			workstreamId: WORKSTREAM,
			widgetId: 'rooms',
			span: { columns: 3, rows: 4 },
		});
		expect(resized.placements[0]).toEqual({ widgetId: 'rooms', span: { columns: 3, rows: 4 } });
		expect((await place('rooms', 1)).placements[1]).toEqual({
			widgetId: 'rooms',
			span: { columns: 3, rows: 4 },
		});

		const refused = (field: string) => ({ ok: false, error: expect.stringContaining(field) });
		const workstreamId = WORKSTREAM;
		await expect(
			call('widgets.place', { workstreamId, widgetId: 'Nope', index: 0 }),
		).resolves.toMatchObject(refused('widgetId'));
		for (const index of [-1, 1.5, null, '0']) {
			await expect(
				call('widgets.place', { workstreamId, widgetId: 'deploy', index }),
			).resolves.toMatchObject(refused('index'));
		}
		for (const span of [
			{ columns: 13, rows: 1 },
			{ columns: 0, rows: 1 },
			{ columns: 1.5, rows: 1 },
			{ columns: 1 },
		]) {
			await expect(
				call('widgets.resize', { workstreamId, widgetId: 'rooms', span }),
			).resolves.toMatchObject(refused('span'));
		}
		await expect(
			call('widgets.resize', { workstreamId, widgetId: 'gone', span: { columns: 1, rows: 1 } }),
		).resolves.toMatchObject(refused('No widget `gone`'));
		await expect(
			call('widgets.place', { workstreamId, widgetId: 'gone', index: 0 }),
		).resolves.toMatchObject(refused('No widget `gone`'));
		await expect(
			call('widgets.share', { workstreamId: '', widgetId: 'rooms' }),
		).resolves.toMatchObject(refused('workstreamId'));
		await expect(call('widgets.watch', { workstreamId, watching: 'yes' })).resolves.toMatchObject(
			refused('watching'),
		);
		await expect(call('widgets.board', { workstreamId: '' })).resolves.toMatchObject(
			refused('workstreamId'),
		);
	});

	it('takes a shared widget off the board, and deletes your own with its reading', async () => {
		publish({ 'deploy.json': DEPLOY });
		await widgets.save(WORKSTREAM, rooms());
		await place('deploy');

		const shared = await remove('deploy');
		expect(shared.placements.map(({ widgetId }) => widgetId)).toEqual(['rooms', 'plan']);
		expect(shared.widgets.map(({ id }) => id)).toEqual(['plan', 'deploy', 'rooms']);

		const mine = await remove('rooms');
		expect(mine.placements.map(({ widgetId }) => widgetId)).toEqual(['plan']);
		expect(mine.widgets.map(({ id }) => id)).toEqual(['plan', 'deploy']);
		expect(mine.readings.map(({ widgetId }) => widgetId)).toEqual([]);
		expect(existsSync(home('rooms'))).toBe(false);
	});

	it('keeps a placed widget whose file an older Malini wrote into the checkout', async () => {
		await board();
		checkoutFile('rooms.json', JSON.stringify({ title: 'Rooms', source: { github: 'user' } }));
		checkoutFile('loose.json', JSON.stringify({ title: 'Loose', source: { github: 'user' } }));
		placeWidget(context.db, BOARD, {
			widgetId: 'rooms',
			before: null,
			span: { columns: 1, rows: 1 },
		});

		const adopted = await board();
		expect(adopted.widgets.map(({ id, origin }) => [id, origin])).toEqual([
			['plan', 'plan'],
			['rooms', 'mine'],
		]);
		expect(adopted.placements.map(({ widgetId }) => widgetId)).toEqual(['plan', 'rooms']);
		expect(existsSync(join(home('rooms'), '.malini/widgets/rooms.json'))).toBe(true);
	});

	it('updates a shared widget for everyone once the default branch changes', async () => {
		restart('szymeo', { sharedCheckMs: 20 });
		publish({ 'deploy.json': DEPLOY });
		await widgets.save(WORKSTREAM, rooms(api, false));
		await place('deploy');
		const changed = vi.fn();
		context.events.subscribe('widgets:board-changed', changed);
		await watch(true);
		await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(1), SLOW);

		const onMain = {
			...rooms(api, false),
			title: 'Rooms on main',
			source: { ...rooms(api, false).source, select: '{value: 9}' },
		};
		publish({
			'deploy.json': {
				...DEPLOY,
				title: 'Deploys',
				source: { ...DEPLOY.source, select: '{value: 2}' },
			},
			'rooms.json': onMain,
		});
		await vi.waitFor(() => expect(changed).toHaveBeenCalledWith({ board: BOARD }), SLOW);
		await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(2), SLOW);
		expect(gh.mock.lastCall?.[0]).toContain('{value: 2}');

		const updated = await board();
		expect(updated.widgets.map(({ id, title, origin }) => [id, title, origin])).toEqual([
			['plan', 'Plan', 'plan'],
			['deploy', 'Deploys', 'shared'],
			['rooms', 'Rooms on main', 'shared'],
		]);
		expect(updated.placements.map(({ widgetId }) => widgetId)).toEqual(['deploy', 'rooms', 'plan']);
		await vi.waitFor(
			async () =>
				expect(
					(await board()).readings.find(({ widgetId }) => widgetId === 'rooms')?.data,
				).toMatchObject({ value: 9 }),
			SLOW,
		);
		await expect(
			context.commands.call('widgets.share', { workstreamId: WORKSTREAM, widgetId: 'rooms' }),
		).rejects.toMatchObject({ kind: 'shared-widget' });
		await watch(false);
	});
});

describe('making a widget a default', () => {
	it('copies your widget into this workstream, where the agent opens its pull request', async () => {
		await widgets.save(WORKSTREAM, rooms());

		await context.commands.call('widgets.share', { workstreamId: WORKSTREAM, widgetId: 'rooms' });

		expect(
			JSON.parse(readFileSync(join(checkout, '.malini/widgets/rooms.json'), 'utf8')),
		).toMatchObject({
			title: 'Rooms',
			source: rooms().source,
			author: 'szymeo',
		});
		expect((await board()).widgets.filter(({ id }) => id === 'rooms')).toHaveLength(1);
	});
});

describe('readings', () => {
	it('keeps the last good data through a failed read and a restart', async () => {
		const deploy = DEPLOY_SAVED;
		const good = (await widgets.save(WORKSTREAM, deploy)).reading;
		expect(good).toMatchObject({ data: { value: 7 }, error: null, reading: false });

		ghAnswer = () => ({ stdout: '', stderr: 'gh: Server Error (HTTP 502)\n', code: 1 });
		const failed = (await widgets.save(WORKSTREAM, deploy)).reading;
		expect(failed).toMatchObject({ data: { value: 7 }, error: 'gh: Server Error (HTTP 502)' });
		expect(failed.readAt).toBe(good.readAt);

		ghAnswer = () => ({ stdout: 'null', stderr: '', code: 0 });
		expect((await widgets.save(WORKSTREAM, deploy)).reading).toMatchObject({
			data: { value: 7 },
			error: 'The source printed JSON, but not an object.',
		});

		restart(null);
		const restarted = await board();
		expect(restarted.me).toBeNull();
		expect(restarted.readings).toEqual([
			expect.objectContaining({ widgetId: 'deploy', data: expect.objectContaining({ value: 7 }) }),
		]);
	});

	it('reads one widget once at a time and tells the board when a read starts and ends', async () => {
		const deploy = DEPLOY_SAVED;
		const seen: Array<[string, boolean]> = [];
		context.events.subscribe('widgets:reading-changed', ({ widgetId, reading }) =>
			seen.push([widgetId, reading]),
		);
		let release = (): void => undefined;
		gh.mockImplementationOnce(async (args) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return ghAnswer(args);
		});
		const first = widgets.save(WORKSTREAM, deploy);
		await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(1));
		const second = widgets.save(WORKSTREAM, deploy);
		setTimeout(() => release(), 200);
		const [left, right] = await Promise.all([first, second]);
		expect(left.reading).toEqual(right.reading);
		expect(gh).toHaveBeenCalledTimes(1);
		expect(seen).toEqual([
			['deploy', true],
			['deploy', false],
		]);
	});
});

describe('watching', () => {
	it('reads only placed widgets while watched, on their events, and stops when unwatched', async () => {
		publish({
			'deploy.json': DEPLOY,
			'suggested.json': { title: 'Suggested', source: { github: 'user' } },
		});
		await place('deploy');
		const paths = () => gh.mock.calls.map(([args]) => args[3]);

		await watch(true);
		await vi.waitFor(() => expect(paths()).toEqual([DEPLOY.source.github]));

		context.events.emit('repositories:changed', {});
		await vi.waitFor(() => expect(paths()).toEqual([DEPLOY.source.github, DEPLOY.source.github]));

		await watch(false);
		context.events.emit('repositories:changed', {});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(paths()).toHaveLength(2);
	});

	it('answers a workstream that is gone as expected, and watches it without a log line', async () => {
		const gone = { workstreamId: 'ws-gone' };
		await expect(context.commands.call('widgets.board', gone)).rejects.toMatchObject({
			kind: 'workstream-gone',
			verdict: 'expected',
		});
		await context.commands.call('widgets.watch', { ...gone, watching: true });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(log).not.toHaveBeenCalled();
		await context.commands.call('widgets.watch', { ...gone, watching: false });
	});

	it('reads a placed widget again once its interval passes, until the workstream is removed', async () => {
		publish({ 'deploy.json': DEPLOY });
		await place('deploy');
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
		try {
			await watch(true);
			await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(1));
			await vi.advanceTimersByTimeAsync(15_000);
			await vi.waitFor(() => expect(gh).toHaveBeenCalledTimes(2));

			context.events.emit('repositories:workstream-removed', {
				workstreamId: WORKSTREAM,
				worktreePath: checkout,
				archived: true,
			});
			await vi.advanceTimersByTimeAsync(60_000);
			expect(gh).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
