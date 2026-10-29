import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	openedUrls,
	recordBrowser,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';

type PlatformRequest = Readonly<{
	method: string;
	path: string;
	body: unknown;
	authorization: string | null;
	contentType: string | null;
	acceptEncoding: string | null;
}>;

type FakeBestboy = Readonly<{
	origin: string;
	requests: PlatformRequest[];
	expectChallenge(challenge: string): void;
	refuseNextStatsUpload(): void;
	close(): void;
}>;

const STATS_KEYS = [
	'days',
	'intensity',
	'languages',
	'mcpServers',
	'models',
	'otherRepositories',
	'repositories',
	'since',
	'skills',
	'techniques',
	'through',
	'tools',
	'totals',
	'version',
];

test('Publish my stats signs in to Bestboy, uploads numbers only, signs in again after a 401, and removes the stats when turned off', async () => {
	test.setTimeout(240_000);
	const platform = await fakeBestboy();
	const app = await launchWithYesterdaysRun({ MALINI_BESTBOY_ORIGIN: platform.origin });
	try {
		const { page } = app;
		await recordBrowser(app);
		await openProfileSettings(page);
		const settings = page.getByRole('dialog', { name: 'Settings' });
		const toggle = settings.getByRole('switch', { name: 'Publish my stats' });
		await expect(toggle).toHaveAttribute('aria-checked', 'false');
		await expect(toggle).toBeEnabled();

		await openUrl(app, 'malini://auth?code=e2e-code&state=meant-for-another-malini');
		await page.waitForTimeout(500);
		expect(platform.requests).toEqual([]);
		await expect(settings.getByText(/^Signed in to Bestboy as/u)).toHaveCount(0);

		await toggle.click();
		await expect(
			settings.getByText('Sign in to Bestboy in your browser, then come back.'),
		).toBeVisible();
		const firstSignIn = await signInUrl(app, platform, 1);
		await openUrl(app, `malini://auth?code=e2e-code&state=not-${firstSignIn.state}`);
		await page.waitForTimeout(500);
		await expect(
			settings.getByText('Sign in to Bestboy in your browser, then come back.'),
		).toBeVisible();
		expect(platform.requests.filter(({ path }) => path === '/api/auth/token')).toEqual([]);
		await openUrl(app, `malini://auth?code=e2e-code&state=${firstSignIn.state}`);

		const handle = settings.getByRole('textbox', { name: 'Your profile address' });
		await expect(handle).toHaveValue('e2e-user');
		await handle.fill('taken');
		await settings.getByRole('button', { name: 'Publish' }).click();
		await expect(settings.getByRole('alert')).toHaveText('Someone else has that handle.');
		await captureFlow(app, 'profile-handle-taken');

		platform.refuseNextStatsUpload();
		await handle.fill('e2e-person');
		await settings.getByRole('button', { name: 'Publish' }).click();
		await expect(settings.getByTestId('profile-url')).toHaveText(
			`${new URL(platform.origin).host}/@e2e-person`,
		);
		await expect(settings.getByTestId('profile-status')).toHaveText(
			'Bestboy signed you out. Sign in again to keep your profile current.',
		);
		await expect(settings.getByText(/^Signed in to Bestboy as/u)).toHaveCount(0);

		await settings.getByRole('button', { name: 'Sign in' }).click();
		const secondSignIn = await signInUrl(app, platform, 2);
		await openUrl(app, `malini://auth?code=e2e-code&state=${secondSignIn.state}`);
		await expect(settings.getByTestId('profile-status')).toHaveText(/^Published through /u, {
			timeout: 20_000,
		});
		await expect(settings.getByText('Signed in to Bestboy as E2E Person')).toBeVisible();
		await captureFlow(app, 'profile-published');

		const uploads = platform.requests.filter((request) => request.path === '/api/stats/malini');
		expect(uploads.map((request) => [request.method, request.authorization])).toEqual([
			['PUT', 'Bearer e2e-token-1'],
			['PUT', 'Bearer e2e-token-2'],
		]);
		const stats = statsBody(uploads.at(-1)?.body);
		expect(Object.keys(stats).sort()).toEqual(STATS_KEYS);
		expect(stats['version']).toBe(1);
		expect(stats['through']).toBe(yesterday());
		expect(stats['since']).toBe(yesterday());
		expect(stats['days']).toEqual([{ date: yesterday(), runs: 1, agents: 1 }]);
		expect(stats['repositories']).toEqual([]);
		expect(stats['otherRepositories']).toEqual({
			public: { repositories: 0, runs: 0 },
			private: { repositories: 1, runs: 1 },
		});
		expect(JSON.stringify(stats)).not.toContain('Count this run');
		expect(
			platform.requests
				.filter(({ path }) => path === '/api/catalog')
				.map(({ method, authorization, acceptEncoding }) => [
					method,
					authorization,
					acceptEncoding?.includes('gzip'),
				]),
		).toEqual([['GET', null, true]]);

		const shown = settings.getByRole('region', { name: 'What your profile shows' });
		await shown.getByRole('checkbox', { name: /^Skills /u }).click();
		await expect(shown.getByRole('checkbox', { name: /^Skills /u })).not.toBeChecked();
		await expect
			.poll(() => platform.requests.filter(({ path }) => path === '/api/stats/malini').length, {
				timeout: 20_000,
			})
			.toBe(3);
		const withoutSkills = statsBody(
			platform.requests.filter(({ path }) => path === '/api/stats/malini').at(-1)?.body,
		);
		expect(Object.keys(withoutSkills).sort()).toEqual(STATS_KEYS.filter((key) => key !== 'skills'));
		await captureFlow(app, 'profile-parts');

		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-checked', 'false');
		await expect(settings.getByTestId('profile-url')).toHaveCount(0);
		await expect
			.poll(() => platform.requests.slice(-2).map(({ method, path, body }) => [method, path, body]))
			.toEqual([
				['DELETE', '/api/stats/malini', null],
				['PUT', '/api/profile', { public: false }],
			]);

		await settings.getByRole('button', { name: 'Sign out' }).click();
		await expect(settings.getByText(/^Signed in to Bestboy as/u)).toHaveCount(0);
		await expect
			.poll(() => platform.requests.at(-1))
			.toMatchObject({ method: 'POST', path: '/api/auth/logout' });

		expect(
			platform.requests
				.filter(({ method }) => method !== 'GET')
				.every(({ contentType }) => contentType === 'application/json'),
		).toBe(true);
		expectCleanConsole(app);
	} finally {
		await app.close();
		platform.close();
	}
});

test('the Stats panel copies the heatmap and readout cards as PNGs drawn from yesterday and before', async () => {
	test.setTimeout(180_000);
	const app = await launchWithYesterdaysRun({});
	try {
		const { page, electronApp } = app;
		await page.getByTestId('sidebar-open-stats').click();
		const cards = page.getByRole('dialog', { name: 'Stats' }).getByRole('region', {
			name: 'Share card',
		});
		for (const kind of ['heatmap', 'readout']) {
			await electronApp.evaluate(async ({ clipboard }) => clipboard.clear());
			await cards.getByRole('button', { name: `Copy the ${kind} card` }).click();
			await expect(page.getByText('Card copied').first()).toBeVisible();
			const size = await electronApp.evaluate(async ({ clipboard }) => {
				const [item] = await clipboard.read();
				const image = await item?.getType('image/png');
				if (!(image instanceof Blob)) return null;
				const png = Buffer.from(await image.arrayBuffer());
				return [png.readUInt32BE(16), png.readUInt32BE(20)];
			});
			expect(size).toEqual([2400, 1260]);
		}
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function launchWithYesterdaysRun(
	env: Readonly<Record<string, string>>,
): Promise<LaunchedApp> {
	const first = await launchMalini();
	try {
		const source = await createSourceRepo(first.root);
		const { workstreamId } = await seedWorkstream(first.page, source, 'e2e-profile-ws', 'Profile');
		await openWorkstream(first.page, workstreamId);
		await sendPrompt(first.page, 'Count this run');
		await expectAssistantReply(first.page);
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}
	const db = new DatabaseSync(join(first.userDataDir, 'malini.sqlite'));
	const start = new Date();
	start.setDate(start.getDate() - 1);
	start.setHours(10, 0, 0, 0);
	db.prepare('UPDATE agent_runs SET started_at = ?, completed_at = ?').run(
		start.toISOString(),
		new Date(start.getTime() + 5 * 60_000).toISOString(),
	);
	db.close();
	return launchMalini({ profile: first.root, env });
}

async function openProfileSettings(page: Page): Promise<void> {
	await page.evaluate(() => {
		location.hash = '#/settings/profile';
	});
	await page.reload();
	await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 20_000 });
}

async function signInUrl(
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

async function openUrl(app: LaunchedApp, url: string): Promise<void> {
	await app.electronApp.evaluate(({ app: electron }, callback) => {
		electron.emit('open-url', { preventDefault: () => undefined }, callback);
	}, url);
}

function statsBody(body: unknown): Readonly<Record<string, unknown>> {
	if (typeof body !== 'object' || body === null) throw new Error('the upload carried no JSON body');
	return Object.fromEntries(Object.entries(body));
}

function yesterday(): string {
	const day = new Date();
	day.setDate(day.getDate() - 1);
	const month = String(day.getMonth() + 1).padStart(2, '0');
	return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, '0')}`;
}

async function fakeBestboy(): Promise<FakeBestboy> {
	const requests: PlatformRequest[] = [];
	let challenge = '';
	let tokens = 0;
	let refuseStats = false;
	const revoked = new Set<string>();
	let profile: { handle: string | null; public: boolean } = { handle: null, public: false };
	const server = createServer((request, response) => {
		void (async () => {
			const url = new URL(request.url ?? '/', 'http://localhost');
			const body = await jsonBody(request);
			const authorization = request.headers.authorization ?? null;
			requests.push({
				method: request.method ?? '',
				path: url.pathname,
				body,
				authorization,
				contentType: request.headers['content-type'] ?? null,
				acceptEncoding: request.headers['accept-encoding'] ?? null,
			});
			const reply = (status: number, value?: unknown): void => {
				response.writeHead(status, { 'content-type': 'application/json' });
				response.end(value === undefined ? '' : JSON.stringify(value));
			};
			const profileReply = (): unknown => ({
				...profile,
				url: profile.handle ? `${origin}/@${profile.handle}` : null,
			});
			const route = `${request.method} ${url.pathname}`;
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
		close: () => server.close(),
	};
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	const text = Buffer.concat(chunks).toString('utf8');
	return text ? JSON.parse(text) : null;
}
