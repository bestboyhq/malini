import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	seedWorkstream,
} from './harness';

function sidebarRow(page: Page, workstreamId: string) {
	return page
		.getByRole('navigation', { name: 'Connected repositories' })
		.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`);
}

test('the top bar walks the history and toggles the sidebar', async () => {
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

		await page.evaluate(() => (globalThis.location.hash = '#/'));
		await expect(page).toHaveTitle('Malini · Repositories');
		await expect(back).toBeEnabled();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('in full screen the top bar stops saving room for the traffic lights, also after a reload', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		await seedWorkstream(page, await createSourceRepo(app.root), 'e2e-topbar-full', 'Full work');
		await page.reload();
		await expect(sidebarRow(page, 'e2e-topbar-full')).toBeVisible({ timeout: 20_000 });
		const root = page.locator('html');
		const fullScreen = (entered: boolean): Promise<void> =>
			electronApp.evaluate(({ BrowserWindow }, entered) => {
				const window = BrowserWindow.getAllWindows()[0];
				if (!window) return;
				window.isFullScreen = () => entered;
				window.emit(entered ? 'enter-full-screen' : 'leave-full-screen');
			}, entered);
		await expect(root).not.toHaveAttribute('data-native-full-screen');

		await fullScreen(true);
		await expect(root).toHaveAttribute('data-native-full-screen');
		await captureFlow(app, 'top-bar-full-screen');
		await page.reload();
		await expect(sidebarRow(page, 'e2e-topbar-full')).toBeVisible({ timeout: 20_000 });
		await expect(root).toHaveAttribute('data-native-full-screen');

		await fullScreen(false);
		await expect(root).not.toHaveAttribute('data-native-full-screen');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
