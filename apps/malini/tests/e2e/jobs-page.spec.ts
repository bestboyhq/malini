import { expect, test } from '@playwright/test';
import { expectCleanConsole, launchMalini } from './harness';

test('the Jobs page keeps jobs and routines under one title and opens the job its address names', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await page.evaluate(() => {
			location.hash = '#/jobs';
		});
		await expect(page).toHaveTitle('Malini · Jobs', { timeout: 20_000 });

		const tabs = page.getByRole('navigation', { name: 'Jobs and routines' });
		const jobList = page.getByRole('navigation', { name: 'Jobs', exact: true });
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jobs');
		await expect(tabs.getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
		await expect(tabs.getByRole('link', { name: 'Routines' })).not.toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(jobList).toBeVisible();

		await tabs.getByRole('link', { name: 'Routines' }).click();
		await expect(page).toHaveTitle('Malini · Routines');
		await expect(tabs.getByRole('link', { name: 'Routines' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(jobList).toHaveCount(0);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jobs');

		await tabs.getByRole('link', { name: 'Jobs' }).click();
		const updateFromMain = jobList.getByRole('link', { name: /Update from main/u });
		await updateFromMain.click();
		await expect(page).toHaveURL(/#\/jobs\/[^/]+$/u);
		await expect(updateFromMain).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('heading', { level: 2, name: 'Update from main' })).toBeVisible();

		await page.reload();
		await expect(updateFromMain).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
		await expect(page.getByRole('heading', { level: 2, name: 'Update from main' })).toBeVisible();

		await jobList.getByRole('link', { name: 'New job' }).click();
		await expect(jobList.getByRole('link', { name: 'New job' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(page.getByRole('heading', { level: 2, name: 'New job' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
