import { expect, test } from '@playwright/test';
import {
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

		await sidebar.getByRole('link', { name: 'Open alpha' }).hover();
		await sidebar.getByRole('button', { name: 'Hide alpha' }).click();

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
