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
	recordBrowser,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';
import { fakeBestboy, openUrl, signInUrl } from './fake-bestboy';

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
