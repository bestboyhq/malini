import { expect, test } from '@playwright/test';
import {
	captureFlow,
	clickRevealedOnHover,
	expectCleanConsole,
	launchMalini,
	openedUrls,
	recordBrowser,
} from './harness';
import { seedWorkstreamOnFakeGithub } from './fake-github';

const HOME_PAGE = 'https://github.com/e2e/hutch';

test('a GitHub repository opens its home page from its sidebar menu, the list and its page', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = await seedWorkstreamOnFakeGithub(app, 'e2e-open-on-github', null);
		await recordBrowser(app);
		await page.reload();

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const repositoryLink = sidebar.getByRole('link', { name: 'Open e2e/hutch', exact: true });
		await expect(repositoryLink).toBeVisible({ timeout: 20_000 });
		await expect(sidebar.getByRole('link', { name: 'Open e2e/hutch on GitHub' })).toHaveCount(0);

		await repositoryLink.click({ button: 'right' });
		await captureFlow(app, 'open-on-github-menu');
		await page
			.getByRole('menu', { name: 'Repository actions' })
			.getByRole('menuitem', { name: 'Open e2e/hutch on GitHub' })
			.click();
		await expect(page.getByRole('menu', { name: 'Repository actions' })).toHaveCount(0);
		await expect.poll(() => openedUrls(app)).toEqual([HOME_PAGE]);

		const list = page.getByTestId('repository-list');
		await clickRevealedOnHover(
			list.getByTestId('repository-row').filter({ hasText: 'e2e/hutch' }),
			list.getByRole('link', { name: 'Open e2e/hutch on GitHub' }),
		);
		await expect.poll(() => openedUrls(app)).toEqual([HOME_PAGE, HOME_PAGE]);

		await repositoryLink.click();
		await page.getByTestId('repository-page').getByRole('link', { name: 'Open on GitHub' }).click();
		await expect.poll(() => openedUrls(app)).toEqual([HOME_PAGE, HOME_PAGE, HOME_PAGE]);
		await captureFlow(app, 'open-on-github-repository-page');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
