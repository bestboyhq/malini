import { expect, test, type Page } from '@playwright/test';
import { JOBS_MAX_CONCURRENT_SETTING, JOBS_RECONCILER_SETTING } from '../../src/contract/jobs';
import {
	MERGE_QUEUE_FIX_ATTEMPTS_SETTING,
	UPDATE_FROM_MAIN_TRIGGER_SETTING,
} from '../../src/contract/pull-requests';
import {
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
		await expect(settingsSection(page, 'Agent')).toHaveAttribute('aria-current', 'page');
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
		const updates = page.getByRole('combobox', { name: 'Update from main' });
		const reconcile = page.getByRole('switch', { name: 'Reconcile events' });
		await expect(running).toHaveValue('3');
		await expect(attempts).toHaveValue('7');
		await expect(updates).toHaveValue('main-moves');
		await expect(reconcile).toHaveAttribute('aria-checked', 'true');

		await reconcile.click();
		await expect(reconcile).toHaveAttribute('aria-checked', 'false');
		await expect
			.poll(async () => (await storedSettings(page))[JOBS_RECONCILER_SETTING])
			.toBe('off');

		await updates.selectOption({ label: 'Only when merging' });
		await expect
			.poll(async () => (await storedSettings(page))[UPDATE_FROM_MAIN_TRIGGER_SETTING])
			.toBe('merging');

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
		await expect(updates).toHaveValue('merging');
		await expect(reconcile).toHaveAttribute('aria-checked', 'false');
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
