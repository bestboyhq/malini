import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	openRepositoriesPage,
	seedWorkstream,
	type LaunchedApp,
} from './harness';

async function archive(app: LaunchedApp, workstreamId: string, merged: boolean): Promise<void> {
	const source = await createSourceRepo(app.root, workstreamId);
	await seedWorkstream(app.page, source, workstreamId, workstreamId);
	await invoke(app.page, 'repositories.archive-workstream', { workstreamId });
	if (!merged) return;
	const db = new DatabaseSync(join(app.userDataDir, 'malini.sqlite'));
	try {
		db.prepare(
			'UPDATE workstreams SET merged_pull_request_number = 7, merged_pull_request_url = ? WHERE id = ?',
		).run('https://github.com/e2e/hutch/pull/7', workstreamId);
	} finally {
		db.close();
	}
}

async function storedSettings(page: Page): Promise<Record<string, string>> {
	return invoke<Record<string, string>>(page, 'app.list-settings', undefined);
}

function card(page: Page) {
	return page.getByRole('region', { name: 'First merge. Where did you hear about Malini?' });
}

test('the first merged and archived workstream asks once where you heard about Malini, and Somewhere else takes your words', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await archive(app, 'e2e-dropped', false);
		await page.reload();
		await openRepositoriesPage(page);
		await expect(page.getByTestId('repository-row').first()).toBeVisible({ timeout: 20_000 });
		await expect(card(page)).toHaveCount(0);

		await archive(app, 'e2e-merged', true);
		await page.reload();
		await openRepositoriesPage(page);
		const ask = card(page);
		await expect(ask).toBeVisible({ timeout: 20_000 });
		const channels = ask.getByRole('group', { name: 'Where you heard about Malini' });
		await expect(channels.getByRole('button')).toHaveCount(10);
		await captureFlow(app, 'heard-about-after-first-merge');

		await channels.getByRole('button', { name: 'Somewhere else' }).click();
		const where = ask.getByRole('textbox', { name: 'Where you heard about Malini' });
		await expect(where).toBeFocused();
		await expect(ask.getByRole('button', { name: 'Send' })).toBeDisabled();
		await where.fill('@syntaxfm podcast');
		await ask.getByRole('button', { name: 'Send' }).click();
		await expect(ask.getByRole('status')).toHaveText('Noted. Thanks');
		await expect(channels).toHaveCount(0);
		await expect
			.poll(async () => (await storedSettings(page))['heard-about'])
			.toBe('syntaxfm podcast');
		await captureFlow(app, 'heard-about-noted');

		await page.reload();
		await openRepositoriesPage(page);
		await expect(page.getByTestId('repository-row').first()).toBeVisible({ timeout: 20_000 });
		await expect(card(page)).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a chip answers where you heard about Malini in one click, and neither a dismissal nor the old setup asks again', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await archive(app, 'e2e-merged', true);
		await page.reload();
		await openRepositoriesPage(page);
		const ask = card(page);
		await expect(ask).toBeVisible({ timeout: 20_000 });
		await ask
			.getByRole('group', { name: 'Where you heard about Malini' })
			.getByRole('button', { name: 'Hacker News' })
			.click();
		await expect(ask.getByRole('status')).toHaveText('Noted. Thanks');
		await expect.poll(async () => (await storedSettings(page))['heard-about']).toBe('hacker-news');

		const db = new DatabaseSync(join(app.userDataDir, 'malini.sqlite'));
		try {
			db.prepare("DELETE FROM settings WHERE key = 'heard-about'").run();
		} finally {
			db.close();
		}
		await page.reload();
		await openRepositoriesPage(page);
		await expect(ask).toBeVisible({ timeout: 20_000 });
		await ask.getByRole('button', { name: 'Dismiss where you heard about Malini' }).click();
		await expect(ask).toHaveCount(0);
		await expect.poll(async () => (await storedSettings(page))['heard-about']).toBe('');

		await page.reload();
		await openRepositoriesPage(page);
		await expect(page.getByTestId('repository-row').first()).toBeVisible({ timeout: 20_000 });
		await expect(ask).toHaveCount(0);

		const upgraded = new DatabaseSync(join(app.userDataDir, 'malini.sqlite'));
		try {
			upgraded.prepare("DELETE FROM settings WHERE key = 'heard-about'").run();
			upgraded
				.prepare("INSERT INTO settings (key, value) VALUES ('onboarding.finished-at', ?)")
				.run('2026-10-01T09:00:00.000Z');
		} finally {
			upgraded.close();
		}
		await page.reload();
		await openRepositoriesPage(page);
		await expect(page.getByTestId('repository-row').first()).toBeVisible({ timeout: 20_000 });
		await expect(ask).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
