import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	openedUrls,
	recordBrowser,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';
import { fakeBestboy, openUrl, signInUrl } from './fake-bestboy';

const STATS_KEYS = [
	'days',
	'intensity',
	'otherRepositories',
	'repositories',
	'since',
	'through',
	'totals',
	'version',
];

test('Publish my stats signs in to Bestboy, uploads numbers only, signs in again after a 401, and removes the stats when turned off', async () => {
	test.setTimeout(240_000);
	const platform = await fakeBestboy();
	const app = await launchWithPastRuns({ MALINI_BESTBOY_ORIGIN: platform.origin });
	try {
		const { page } = app;
		await recordBrowser(app);
		await openProfileSettings(page);
		const settings = page.getByRole('dialog', { name: 'Settings' });
		const toggle = settings.getByRole('switch', { name: 'Publish my stats' });
		await expect(toggle).toHaveAttribute('aria-checked', 'false');
		await expect(toggle).toBeEnabled();
		await expect(settings.getByText('Not signed in to Bestboy')).toBeVisible();

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
		expect(stats['totals']).toMatchObject({
			runs: 1,
			jobRuns: 0,
			automatedRuns: 0,
			inputTokens: 10,
			outputTokens: 5,
		});
		expect(stats['repositories']).toEqual([]);
		expect(stats['otherRepositories']).toEqual({
			public: { repositories: 0, runs: 0 },
			private: { repositories: 1, runs: 1 },
		});
		expect(JSON.stringify(stats)).not.toContain('Count this run');
		expect(platform.requests.map(({ path }) => path)).not.toContain('/api/catalog');

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
		await expect(settings.getByText('Not signed in to Bestboy')).toBeVisible();
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

test('the Stats panel nudges to publish, copies the heatmap and readout cards once the profile is public, and a milestone then shows only its badge with Share', async () => {
	test.setTimeout(240_000);
	const platform = await fakeBestboy();
	const app = await launchWithPastRuns({ MALINI_BESTBOY_ORIGIN: platform.origin }, 7);
	try {
		const { page, electronApp } = app;
		await recordBrowser(app);
		const stats = page.getByRole('dialog', { name: 'Stats' });
		const cards = stats.getByRole('region', { name: 'Share card' });
		const peek = page.getByRole('region', { name: 'Milestone' });
		const share = peek.getByRole('button', {
			name: 'Share your card: 7 days straight, agents skipped lunch',
		});
		await expect(share).toBeVisible({ timeout: 20_000 });
		await expect(share).not.toHaveText('Share');
		await page.getByTestId('sidebar-open-stats').click();
		await expect(cards.getByRole('button', { name: 'Publish my stats' })).toBeVisible();
		await expect(cards.getByRole('button', { name: /^Copy the / })).toHaveCount(0);
		await captureFlow(app, 'profile-share-nudge');

		await openProfileSettings(page);
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await settings.getByRole('button', { name: 'Sign in' }).click();
		await expect(
			settings.getByText('Sign in to Bestboy in your browser, then come back.'),
		).toBeVisible();
		const signIn = await signInUrl(app, platform, 1);
		await openUrl(app, `malini://auth?code=e2e-code&state=${signIn.state}`);
		await expect(settings.getByText('Signed in to Bestboy as E2E Person')).toBeVisible();
		await expect(settings.getByRole('switch', { name: 'Publish my stats' })).toHaveAttribute(
			'aria-checked',
			'false',
		);
		expect(platform.requests.filter(({ path }) => path === '/api/stats/malini')).toEqual([]);
		await page.keyboard.press('Escape');
		await expect(settings).toHaveCount(0);

		await page.getByTestId('sidebar-open-stats').click();
		await cards.getByRole('button', { name: 'Publish my stats' }).click();
		await expect(stats).toHaveCount(0);
		const handle = settings.getByRole('textbox', { name: 'Your profile address' });
		await expect(handle).toHaveValue('e2e-user');
		await handle.fill('e2e-person');
		await settings.getByRole('button', { name: 'Publish' }).click();
		await expect(settings.getByTestId('profile-status')).toHaveText(/^Published through /u, {
			timeout: 20_000,
		});
		await page.keyboard.press('Escape');
		await expect(settings).toHaveCount(0);

		await expect(share).toHaveText('Share');
		await captureFlow(app, 'moment-badge-share');
		await share.click();
		const sheet = page.getByRole('dialog', { name: '7 days straight. Agents skipped lunch.' });
		await expect(sheet.getByRole('button', { name: 'Copy card' })).toBeVisible();
		await expect(sheet.getByRole('button', { name: 'Copy link' })).toBeVisible();
		await expect(sheet.getByRole('button', { name: /^Claim / })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(sheet).toHaveCount(0);

		await page.getByTestId('sidebar-open-stats').click();
		await expect(cards.getByRole('button', { name: 'Publish my stats' })).toHaveCount(0);
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
		platform.close();
	}
});

test('a 7-day streak that ended three days ago peeks out of the sidebar in place of recently archived as your card, claims your profile from its sheet, and stays away once switched off or dismissed', async () => {
	test.setTimeout(240_000);
	const platform = await fakeBestboy();
	const app = await launchWithPastRuns({ MALINI_BESTBOY_ORIGIN: platform.origin }, 7, 3);
	try {
		const { page } = app;
		await recordBrowser(app);
		const peek = page.getByRole('region', { name: 'Milestone' });
		const archived = page.getByRole('list', { name: 'Recently archived' });
		await expect(peek.getByText('7 days straight')).toBeVisible({ timeout: 20_000 });
		await expect(peek.getByText('agents skipped lunch')).toBeVisible();
		await expect(archived).toHaveCount(0);
		await captureFlow(app, 'moment-peek');

		await peek
			.getByRole('button', { name: 'Share your card: 7 days straight, agents skipped lunch' })
			.click();
		const sheet = page.getByRole('dialog', { name: '7 days straight. Agents skipped lunch.' });
		await expect(sheet.getByRole('button', { name: 'Readout' })).toBeVisible();
		await sheet.getByRole('button', { name: 'Readout' }).click();
		await expect(sheet.getByRole('button', { name: 'Readout' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await captureFlow(app, 'moment-sheet');
		await sheet.getByRole('button', { name: 'Claim @e2e-user' }).click();
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(
			settings.getByText('Sign in to Bestboy in your browser, then come back.'),
		).toBeVisible();
		await expect.poll(async () => (await openedUrls(app)).length).toBe(1);
		await settings.getByRole('button', { name: 'Cancel' }).click();

		const milestones = settings.getByRole('switch', { name: 'Milestone cards' });
		await milestones.click();
		await expect(milestones).toHaveAttribute('aria-checked', 'false');
		await page.keyboard.press('Escape');
		await expect(settings).toHaveCount(0);
		await expect(peek).toHaveCount(0);

		await openProfileSettings(page);
		await settings.getByRole('switch', { name: 'Milestone cards' }).click();
		await page.keyboard.press('Escape');
		await expect(peek.getByText('7 days straight')).toBeVisible({ timeout: 20_000 });
		await peek.getByRole('button', { name: 'Dismiss milestone' }).click();
		await expect(peek).toHaveCount(0);
		await expect(archived.getByRole('listitem')).toHaveCount(1);
		await page.reload();
		await expect(page.getByTestId('sidebar-open-stats')).toBeVisible({ timeout: 20_000 });
		await page.waitForTimeout(1_000);
		await expect(peek).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
		platform.close();
	}
});

async function launchWithPastRuns(
	env: Readonly<Record<string, string>>,
	streakDays = 1,
	lastDaysAgo = 1,
): Promise<LaunchedApp> {
	const first = await launchMalini();
	try {
		const source = await createSourceRepo(first.root);
		const { workstreamId } = await seedWorkstream(first.page, source, 'e2e-profile-ws', 'Profile');
		await seedWorkstream(first.page, source, 'e2e-profile-archived', 'Archived');
		await invoke(first.page, 'repositories.archive-workstream', {
			workstreamId: 'e2e-profile-archived',
		});
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
	start.setDate(start.getDate() - lastDaysAgo);
	start.setHours(10, 0, 0, 0);
	db.prepare('UPDATE agent_runs SET started_at = ?, completed_at = ?').run(
		start.toISOString(),
		new Date(start.getTime() + 5 * 60_000).toISOString(),
	);
	for (let daysBack = 1; daysBack < streakDays; daysBack += 1) {
		const day = new Date(start);
		day.setDate(day.getDate() - daysBack);
		db.exec('CREATE TEMP TABLE earlier_run AS SELECT * FROM agent_runs LIMIT 1');
		db.prepare('UPDATE earlier_run SET id = ?, started_at = ?, completed_at = ?').run(
			`e2e-streak-run-${daysBack}`,
			day.toISOString(),
			new Date(day.getTime() + 5 * 60_000).toISOString(),
		);
		db.exec('INSERT INTO agent_runs SELECT * FROM earlier_run; DROP TABLE earlier_run');
	}
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
