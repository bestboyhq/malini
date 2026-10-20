import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('a workstream row opens its own actions on right click, and deleting one leaves only if it was open', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const other = await seedWorkstream(page, source, 'e2e-menu-other', 'Other work');
		const open = await seedWorkstream(page, source, 'e2e-menu-open', 'Open work');
		await openWorkstream(page, open.workstreamId);

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const row = (workstreamId: string) =>
			sidebar.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`);
		const menu = page.getByRole('menu', { name: 'Workstream actions' });
		await expect(page.getByRole('button', { name: 'Workstream actions' })).toHaveCount(0);

		await row(other.workstreamId).click({ button: 'right' });
		await expect(menu.getByRole('menuitem')).toHaveText([
			'Open in editor',
			'Reveal in Finder',
			'Delete workstream',
		]);
		await expect(row(open.workstreamId)).toHaveAttribute('aria-current', 'page');
		await captureFlow(app, 'workstream-context-menu');

		const remove = menu.getByRole('menuitem', { name: /delete workstream/iu });
		await remove.click();
		await expect(remove).toHaveText('Click again to delete');
		await remove.click();
		await expect(row(other.workstreamId)).toHaveCount(0, { timeout: 30_000 });
		await expect(menu).toHaveCount(0);
		expect(existsSync(other.worktree)).toBe(false);
		await expect(row(open.workstreamId)).toHaveAttribute('aria-current', 'page');

		await row(open.workstreamId).focus();
		await page.keyboard.press('Shift+F10');
		await expect(menu).toBeVisible();
		await page.keyboard.press('ArrowDown');
		await expect(menu.getByRole('menuitem', { name: 'Open workstream in editor' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(row(open.workstreamId)).toBeFocused();

		await row(open.workstreamId).click({ button: 'right' });
		await remove.click();
		await remove.click();
		await expect(row(open.workstreamId)).toHaveCount(0, { timeout: 30_000 });
		await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
