import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	fileExists,
	invoke,
	launchMalini,
	seedWorkstream,
	type WorkstreamRow,
} from './harness';

async function openStorageSettings(page: Page) {
	await page.getByTestId('global-topbar-open-settings').click();
	await page
		.getByRole('navigation', { name: 'Settings' })
		.getByRole('link', { name: 'Storage' })
		.click();
	return page.getByRole('dialog', { name: 'Settings' });
}

test('a checkouts folder chosen in Settings takes every checkout along at the next launch', async () => {
	test.setTimeout(180_000);
	const first = await launchMalini();
	const chosen = join(realpathSync(first.root), 'chosen-checkouts');
	mkdirSync(chosen);
	let worktree = '';
	try {
		const { electronApp, page } = first;
		const source = await createSourceRepo(first.root);
		({ worktree } = await seedWorkstream(page, source, 'e2e-moved-ws', 'Moved workstream'));
		await electronApp.evaluate(({ dialog }, folder) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
		}, chosen);

		const settings = await openStorageSettings(page);
		await expect(settings.getByText(join(first.userDataDir, 'checkouts'))).toBeVisible();
		await settings.getByRole('button', { name: 'Change…' }).click();

		await expect(settings.getByText(`Moving to ${chosen} on restart`)).toBeVisible();
		await expect(settings.getByRole('button', { name: 'Restart now' })).toBeVisible();
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const moved = join(chosen, 'workstreams', basename(worktree));
	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await expect(page).toHaveTitle('Malini · Repositories');
		const workstreams = await invoke<WorkstreamRow[]>(page, 'repositories.list-workstreams');
		expect(workstreams.find((row) => row.id === 'e2e-moved-ws')?.path).toBe(moved);
		expect(fileExists(join(moved, 'seed.txt'))).toBe(true);

		const row = page.getByTestId('sidebar-workstream').filter({ hasText: 'Moved workstream' });
		const totals = row.getByTestId('sidebar-workstream-change-totals');
		appendFileSync(join(moved, 'seed.txt'), 'moved along\n');
		await expect(totals).toHaveAccessibleName('1 additions, 0 deletions', { timeout: 20_000 });

		const settings = await openStorageSettings(page);
		await expect(settings.getByText(chosen, { exact: true })).toBeVisible();
		await expect(settings.getByText(/^Moving to /u)).toBeHidden();
		await captureFlow(app, 'checkouts-folder');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
