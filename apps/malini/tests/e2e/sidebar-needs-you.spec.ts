import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	captureFlow,
	connectFolder,
	createSourceRepo,
	expectCleanConsole,
	expectPicker,
	launchMalini,
	seedWorkstream,
} from './harness';

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

test('a new install opens with the default sidebar, and Sidebar options can show only what needs you', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await expectPicker(page);
		await connectFolder(app, 'pasture');
		const source = await createSourceRepo(app.root, 'meadow');
		await seedWorkstream(page, source, 'e2e-sidebar-needs-you', 'Quiet work');
		await page.reload();

		const quiet = sidebar(page).getByTestId('sidebar-workstream').filter({ hasText: 'Quiet work' });
		await expect(quiet).toBeVisible({ timeout: 20_000 });
		await expect(sidebar(page).getByText('Nothing needs you.')).toHaveCount(0);

		await page.getByRole('button', { name: 'Sidebar options' }).click();
		const panel = page.getByRole('group', { name: 'Sidebar options' });
		const option = (group: string, name: string): Locator =>
			panel
				.getByRole('group', { name: group, exact: true })
				.getByRole('button', { name, exact: true });
		await expect(option('Repositories', 'Separate')).toHaveAttribute('aria-pressed', 'true');
		await expect(option('Show', 'Everything')).toHaveAttribute('aria-pressed', 'true');
		await expect(option('Row height', 'Compact')).toHaveAttribute('aria-pressed', 'true');

		await option('Show', 'Only what needs me').click();
		await expect(option('Show', 'Only what needs me')).toHaveAttribute('aria-pressed', 'true');
		await page.keyboard.press('Escape');
		await expect(sidebar(page).getByText('Nothing needs you.')).toBeVisible();
		await expect(quiet).toHaveCount(0);
		await captureFlow(app, 'sidebar-needs-me-empty');

		await sidebar(page)
			.getByRole('button', { name: /Show all$/u })
			.click();
		await expect(quiet).toBeVisible();
		await expect(sidebar(page).getByText('Nothing needs you.')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
