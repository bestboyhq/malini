import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('the extension directory lists the bundled extensions at once, opens a detail and goes back through history, and opens the extension panel', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-extension-directory',
			'Extension directory',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'Add extensions' }).click();
		const directory = page.getByRole('heading', { name: 'Extensions', level: 1 });
		await expect(directory).toBeVisible();
		const card = page.getByRole('link', { name: /Repository/u });
		await expect(card).toBeVisible();
		await expect(page.getByText('Loading', { exact: false })).toHaveCount(0);

		const search = page.getByRole('searchbox', { name: 'Search extensions' });
		await search.fill('zzz');
		await expect(page.getByText('No extensions match “zzz”.')).toBeVisible();
		await search.fill('repo');
		await expect(card).toBeVisible();
		await captureFlow(app, 'extension-directory');

		await card.click();
		const detail = page.getByRole('heading', { name: 'Repository', level: 1 });
		await expect(detail).toBeVisible();
		await expect(detail).toBeFocused();
		await expect(page.getByText('Always available')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Enable for this repository' })).toHaveCount(0);

		await page.goBack();
		await expect(directory).toBeVisible();
		await page.goForward();
		await expect(detail).toBeVisible();
		await page.getByRole('link', { name: 'Extensions', exact: true }).click();
		await expect(directory).toBeVisible();
		await card.click();

		await page.getByRole('button', { name: 'Open Repository' }).click();
		await expect(inspector.getByRole('tab', { name: 'Files' })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
