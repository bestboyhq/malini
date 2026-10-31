import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	GITHUB_REPOSITORIES_FIXTURE,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	listProjects,
	seedWorkstream,
} from './harness';

test('hiding a repository takes it out of the sidebar and the list, and unhiding brings it back', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		const beta = await createSourceRepo(app.root, 'beta');
		await seedWorkstream(page, alpha, 'e2e-hide-alpha', 'Alpha work');
		await seedWorkstream(page, beta, 'e2e-hide-beta', 'Beta work');
		await page.reload();

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const list = page.getByTestId('repository-list');
		const hidden = page.getByRole('list', { name: 'Hidden repositories' });
		await expect(sidebar.getByRole('link', { name: 'Open alpha' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(list.getByText('alpha', { exact: true })).toBeVisible();

		await sidebar.getByRole('link', { name: 'Open alpha' }).click({ button: 'right' });
		await page
			.getByRole('menu', { name: 'Repository actions' })
			.getByRole('menuitem', { name: 'Hide alpha' })
			.click();

		await expect(sidebar.getByRole('link', { name: 'Open alpha' })).toHaveCount(0);
		await expect(sidebar.getByRole('link', { name: 'Open beta' })).toBeVisible();
		await expect(list.getByText('alpha', { exact: true })).toHaveCount(0);
		await page.getByText('Hidden (1)').click();
		await expect(hidden.getByText('alpha', { exact: true })).toBeVisible();
		expect((await listProjects(page)).map((project) => project.id).sort()).toEqual([
			'local__alpha',
			'local__beta',
		]);
		await captureFlow(app, 'hide-repository-hidden-section');

		await page.reload();
		await expect(sidebar.getByRole('link', { name: 'Open beta' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(sidebar.getByRole('link', { name: 'Open alpha' })).toHaveCount(0);

		await list.getByTestId('repository-row').filter({ hasText: 'beta' }).hover();
		await list.getByRole('button', { name: 'Hide beta' }).click();
		await expect(sidebar.getByRole('link', { name: 'Open beta' })).toHaveCount(0);
		await expect(sidebar.getByText('Every repository is hidden')).toBeVisible();
		await expect(
			page.getByRole('region', { name: 'Repositories' }).getByText('Every repository is hidden'),
		).toBeVisible();

		await page.getByText('Hidden (2)').click();
		await hidden.getByRole('button', { name: 'Unhide alpha' }).click();
		await expect(sidebar.getByRole('link', { name: 'Open alpha' })).toBeVisible();
		await expect(list.getByText('alpha', { exact: true })).toBeVisible();
		await expect(hidden.getByText('beta', { exact: true })).toBeVisible();
		await captureFlow(app, 'hide-repository-unhidden');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('cloning a hidden repository again brings it back', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'hutch');
		writeFileSync(
			join(app.home, GITHUB_REPOSITORIES_FIXTURE),
			JSON.stringify([
				{ full_name: 'e2e/hutch', clone_url: `file://${source}`, description: null },
			]),
		);
		const setup = page.getByTestId('onboarding');
		await setup.getByRole('button', { name: 'Continue' }).click();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();
		await cloneHutch(page);

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const hutch = sidebar.getByRole('link', { name: /^Open .*\/hutch$/u });
		await expect(hutch).toBeVisible({ timeout: 30_000 });
		await hutch.click({ button: 'right' });
		await page
			.getByRole('menu', { name: 'Repository actions' })
			.getByRole('menuitem', { name: /^Hide .*\/hutch$/u })
			.click();
		await expect(hutch).toHaveCount(0);

		await page.evaluate(() => {
			location.hash = '#/';
		});
		await cloneHutch(page);
		await expect(hutch).toBeVisible({ timeout: 30_000 });
		await captureFlow(app, 'hide-repository-recloned');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function cloneHutch(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Clone a GitHub repository' }).first().click();
	const dialog = page.getByRole('dialog', { name: 'Clone GitHub repo' });
	await dialog.getByRole('button', { name: /e2e\/hutch/u }).click();
	await dialog.getByRole('button', { name: 'Clone repo' }).click();
	await expect(dialog).toHaveCount(0, { timeout: 30_000 });
	await expect(page.getByTestId('repository-page')).toBeVisible({ timeout: 30_000 });
}
