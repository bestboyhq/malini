import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	listProjects,
	openWorkstream,
	seedWorkstream,
	type LaunchedApp,
} from './harness';

async function pickFolderNext(app: LaunchedApp, path: string): Promise<void> {
	await app.electronApp.evaluate(({ dialog }, picked) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
	}, path);
}

async function openAddMenu(page: Page) {
	const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
	const box = await sidebar.boundingBox();
	if (!box) throw new Error('the sidebar has no box');
	await sidebar.click({ button: 'right', position: { x: box.width / 2, y: box.height - 12 } });
	const menu = page.getByRole('menu', { name: 'Add a repository' });
	await expect(menu).toBeVisible();
	return menu;
}

test('right-clicking the sidebar opens a folder or clones a repository', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		const beta = await createSourceRepo(app.root, 'beta');
		await seedWorkstream(page, alpha, 'e2e-add-menu-alpha', 'Alpha work');
		await openWorkstream(page, 'e2e-add-menu-alpha');

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		await sidebar.getByRole('link', { name: 'Open alpha' }).click({ button: 'right' });
		await expect(page.getByRole('menu', { name: 'Repository actions' })).toBeVisible();
		await expect(page.getByRole('menu', { name: 'Add a repository' })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu', { name: 'Repository actions' })).toHaveCount(0);

		await captureFlow(app, 'connect-repository-menu-before');
		const menu = await openAddMenu(page);
		await captureFlow(app, 'connect-repository-menu');
		await pickFolderNext(app, beta);
		await menu.getByRole('menuitem', { name: 'Open folder…' }).click();

		await expect(page).toHaveURL(/#\/repositories\//u, { timeout: 30_000 });
		await expect(page.getByRole('textbox', { name: /^Scratchpad for .*beta$/u })).toBeVisible();
		await expect
			.poll(async () => (await listProjects(page)).map((project) => project.id).sort())
			.toEqual(['local__alpha', 'local__beta']);

		await (await openAddMenu(page)).getByRole('menuitem', { name: 'Clone repository…' }).click();
		const dialog = page.getByRole('dialog', { name: 'Clone GitHub repo' });
		await expect(dialog).toBeVisible();
		await expect(page.getByTestId('repository-list-page')).toBeVisible();
		await captureFlow(app, 'connect-repository-menu-clone');
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
