import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import { JOBS_MAX_CONCURRENT_SETTING } from '../../src/contract/jobs';
import { MERGE_QUEUE_FIX_ATTEMPTS_SETTING } from '../../src/contract/pull-requests';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	seedWorkstream,
} from './harness';

function settingsSection(page: Page, name: string) {
	return page
		.getByRole('navigation', { name: 'Settings' })
		.getByRole('link', { name, exact: true });
}

async function openSettings(page: Page, hash: string): Promise<void> {
	await page.evaluate((next) => {
		location.hash = next;
	}, hash);
	await page.reload();
}

async function storedSettings(page: Page): Promise<Record<string, string>> {
	return invoke<Record<string, string>>(page, 'app.list-settings', undefined);
}

test('Settings open over the current page, take focus, and close on Escape', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-settings-open-ws', 'Settings open');
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible({
			timeout: 20_000,
		});

		await page.getByTestId('sidebar-open-settings').click();
		const dialog = page.getByRole('dialog', { name: 'Settings' });
		await expect(dialog).toBeVisible();
		await expect(settingsSection(page, 'Accounts')).toHaveAttribute('aria-current', 'page');
		await expect
			.poll(() => dialog.evaluate((element) => element.matches(':focus-within')))
			.toBe(true);
		await expect(page.getByRole('heading', { name: 'Repositories' })).toBeAttached();
		expect(await page.evaluate(() => location.hash)).toBe('#/');

		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings opened while the app still loads its first page stay open', async () => {
	const app = await launchMalini();
	try {
		const { page } = app;
		await page.evaluate(() => {
			location.hash = '#/settings/privacy';
		});
		await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
		await expect(page.getByRole('group', { name: 'Streamer mode' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings → Privacy shows the numbers usage data sends about yesterday, and hides them once sharing is off', async () => {
	test.setTimeout(120_000);
	const first = await launchMalini();
	try {
		const source = await createSourceRepo(first.root);
		await seedWorkstream(first.page, source, 'e2e-usage-merged', 'Merged yesterday');
		await seedWorkstream(first.page, source, 'e2e-usage-dropped', 'Dropped yesterday');
		for (const workstreamId of ['e2e-usage-merged', 'e2e-usage-dropped'])
			await invoke(first.page, 'repositories.archive-workstream', { workstreamId });
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}
	const yesterday = (hour: number, minute = 0): string => {
		const at = new Date();
		at.setDate(at.getDate() - 1);
		at.setHours(hour, minute, 0, 0);
		return at.toISOString();
	};
	const db = new DatabaseSync(join(first.userDataDir, 'malini.sqlite'));
	db.prepare(
		'UPDATE workstreams SET created_at = ?, archived_at = ?, merged_pull_request_number = ? WHERE id = ?',
	).run(yesterday(9), yesterday(10), 7, 'e2e-usage-merged');
	db.prepare('UPDATE workstreams SET created_at = ?, archived_at = ? WHERE id = ?').run(
		yesterday(11),
		yesterday(12),
		'e2e-usage-dropped',
	);
	db.prepare(
		"INSERT INTO agent_sessions (id, workstream_id, status, started_at, origin) VALUES ('e2e-usage-chat', 'e2e-usage-merged', 'idle', ?, 'user')",
	).run(yesterday(9, 5));
	db.prepare(
		"INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at) VALUES ('e2e-usage-run', 'e2e-usage-chat', 'Fix the gap', ?, ?)",
	).run(yesterday(9, 5), yesterday(9, 20));
	db.close();

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await openSettings(page, '#/settings/privacy');
		const share = page.getByRole('switch', { name: 'Share usage data' });
		await expect(share).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
		const numbers = page.getByRole('button', { name: "Yesterday's numbers" });
		await numbers.click();
		await expect(numbers).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByRole('term')).toHaveText([
			'Workstreams started',
			'Prompts',
			'Merged',
			'Archived without merging',
			'Prompts per merge',
			'Minutes to merge',
			'Using Malini for',
		]);
		await expect(page.getByRole('definition')).toHaveText(['2', '1', '1', '1', '1', '60', 'a day']);
		await captureFlow(app, 'settings-privacy-usage-numbers');

		await share.click();
		await expect(share).toHaveAttribute('aria-checked', 'false');
		await expect(numbers).toHaveCount(0);
		await expect(page.getByRole('term')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings → Privacy shows usage data off while the login shell sets DO_NOT_TRACK', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ shellProfile: 'DO_NOT_TRACK=1\nexport DO_NOT_TRACK\n' });
	try {
		const { page } = app;
		await openSettings(page, '#/settings/privacy');
		await expect(page.getByText('is set in your shell, so Malini sends nothing.')).toBeVisible({
			timeout: 20_000,
		});
		const share = page.getByRole('switch', { name: 'Share usage data' });
		await expect(share).toHaveAttribute('aria-checked', 'false');
		await expect(share).toBeDisabled();
		await expect(page.getByRole('button', { name: "Yesterday's numbers" })).toHaveCount(0);
		expect(await storedSettings(page)).not.toHaveProperty('usage-data');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings → Jobs shows the defaults, clamps a value out of range, keeps a cleared one, and saves', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await invoke(page, 'app.set-setting', { key: MERGE_QUEUE_FIX_ATTEMPTS_SETTING, value: '7' });
		await openSettings(page, '#/settings/jobs');

		const running = page.getByRole('spinbutton', { name: 'Jobs running at once' });
		const attempts = page.getByRole('spinbutton', { name: 'Fix attempts before asking you' });
		await expect(settingsSection(page, 'Jobs')).toHaveAttribute('aria-current', 'page', {
			timeout: 20_000,
		});
		await expect(running).toHaveValue('3');
		await expect(attempts).toHaveValue('7');
		await expect(page.getByRole('switch', { name: 'Reconcile events' })).toHaveCount(0);
		await expect(page.getByRole('combobox', { name: 'Update from main' })).toHaveCount(0);
		await captureFlow(app, 'settings-jobs');

		await running.fill('5');
		await running.press('Enter');
		await expect(running).toHaveValue('5');
		await expect
			.poll(async () => (await storedSettings(page))[JOBS_MAX_CONCURRENT_SETTING])
			.toBe('5');

		await running.fill('50');
		await running.press('Enter');
		await attempts.fill('0');
		await attempts.press('Enter');
		await expect(running).toHaveValue('10');
		await expect(attempts).toHaveValue('1');
		await expect
			.poll(async () => {
				const stored = await storedSettings(page);
				return [stored[JOBS_MAX_CONCURRENT_SETTING], stored[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]];
			})
			.toEqual(['10', '1']);

		await running.fill('');
		await running.press('Enter');
		await expect(running).toHaveValue('10');

		await openSettings(page, '#/settings/jobs');
		await expect(running).toHaveValue('10', { timeout: 20_000 });
		await expect(attempts).toHaveValue('1');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings → Models picks the model new chats start with for each mode, and keeps it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openSettings(page, '#/settings/models');

		await expect(settingsSection(page, 'Models')).toHaveAttribute('aria-current', 'page', {
			timeout: 20_000,
		});
		const planning = page.getByRole('combobox', { name: 'Planning model' });
		await expect(page.getByRole('combobox', { name: 'Implementation model' })).toBeVisible();
		await expect(planning).toBeEnabled({ timeout: 20_000 });
		const current = await planning.inputValue();
		const values = await planning
			.getByRole('option')
			.evaluateAll((options) => options.map((option) => option.getAttribute('value') ?? ''));
		const other = values.find((value) => value !== current);
		if (!other) throw new Error('Planning model offers one model only');
		await planning.selectOption(other);
		await expect(planning).toHaveValue(other);

		await openSettings(page, '#/settings/models');
		await expect(page.getByRole('combobox', { name: 'Planning model' })).toHaveValue(other, {
			timeout: 20_000,
		});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
