import { expect, test, type Page } from '@playwright/test';
import { createSourceRepo, expectCleanConsole, launchMalini, seedWorkstream } from './harness';

function sidebarRow(page: Page, workstreamId: string) {
	return page
		.getByRole('navigation', { name: 'Connected repositories' })
		.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`);
}

test('the top bar walks the history and toggles the sidebar, and the sidebar footer links back to the repositories', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-topbar-first', 'First work');
		await seedWorkstream(page, source, 'e2e-topbar-second', 'Second work');
		await page.reload();

		const bar = page.getByRole('navigation', { name: 'Global actions' });
		const back = bar.getByRole('button', { name: 'Go back' });
		const forward = bar.getByRole('button', { name: 'Go forward' });
		await expect(sidebarRow(page, 'e2e-topbar-first')).toBeVisible({ timeout: 20_000 });
		await expect(back).toBeDisabled();
		await expect(forward).toBeDisabled();

		await sidebarRow(page, 'e2e-topbar-first').click();
		await expect(sidebarRow(page, 'e2e-topbar-first')).toHaveAttribute('aria-current', 'page');
		await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 20_000 });
		await expect(bar.getByRole('button', { name: /^Pull request .* detail$/u })).toHaveCount(0);
		await sidebarRow(page, 'e2e-topbar-second').click();
		await expect(sidebarRow(page, 'e2e-topbar-second')).toHaveAttribute('aria-current', 'page');

		await back.click();
		await expect(sidebarRow(page, 'e2e-topbar-first')).toHaveAttribute('aria-current', 'page');
		await expect(forward).toBeEnabled();
		await forward.click();
		await expect(sidebarRow(page, 'e2e-topbar-second')).toHaveAttribute('aria-current', 'page');
		await expect(forward).toBeDisabled();

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		await bar.getByRole('button', { name: 'Hide sidebar' }).click();
		const show = bar.getByRole('button', { name: 'Show sidebar' });
		await expect(show).toHaveAttribute('aria-expanded', 'false');
		await expect(sidebar).toBeHidden();
		await show.click();
		await expect(bar.getByRole('button', { name: 'Hide sidebar' })).toHaveAttribute(
			'aria-expanded',
			'true',
		);
		await expect(sidebar).toBeVisible();

		await expect(bar.getByRole('link', { name: 'Connect repository' })).toHaveCount(0);
		await page.getByRole('complementary').getByRole('link', { name: 'Connect repository' }).click();
		await expect(page).toHaveTitle('Malini · Repositories');
		await expect(back).toBeEnabled();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
