import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	GITHUB_REPOSITORIES_FIXTURE,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	listProjects,
} from './harness';

test('cloning picks a recent GitHub repository and opens a workstream in it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'hutch');
		writeFileSync(
			join(app.home, GITHUB_REPOSITORIES_FIXTURE),
			JSON.stringify([
				{
					full_name: 'e2e/hutch',
					clone_url: `file://${source}`,
					description: 'Where the rabbits live.',
				},
				{
					full_name: 'e2e/burrow',
					clone_url: 'https://github.com/e2e/burrow.git',
					description: null,
				},
			]),
		);

		await page.getByRole('button', { name: 'Clone a GitHub repository' }).click();
		const dialog = page.getByRole('dialog', { name: 'Clone GitHub repo' });
		const url = dialog.getByLabel('Repository URL');
		const submit = dialog.getByRole('button', { name: 'Clone repo' });
		await expect(url).toBeFocused();
		await expect(submit).toBeDisabled();

		const recent = dialog.getByRole('list', { name: 'Recent repositories' });
		await expect(recent.getByRole('button')).toHaveCount(2);
		await dialog.getByLabel('Search repositories').fill('rabbit');
		await expect(recent.getByRole('button')).toHaveCount(1);
		const hutch = recent.getByRole('button', { name: /e2e\/hutch/ });
		await hutch.click();
		await expect(hutch).toHaveAttribute('aria-pressed', 'true');
		await expect(url).toHaveValue(`file://${source}`);
		await expect(submit).toBeEnabled();
		await captureFlow(app, 'clone-repository-dialog');

		await page.keyboard.press('Meta+Enter');
		await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 30_000 });
		await expect(dialog).toHaveCount(0);
		await expect
			.poll(async () => (await listProjects(page)).some((project) => project.id.endsWith('hutch')))
			.toBe(true);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
