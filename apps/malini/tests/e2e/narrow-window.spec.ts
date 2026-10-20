import { expect, test, type Locator } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('a narrow window folds the sidebar away and keeps a compact inspector beside a full-height chat', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-narrow-window-ws',
			'Narrow window workstream',
		);
		await openWorkstream(page, workstreamId);
		const resize = (width: number): Promise<void> =>
			electronApp.evaluate(
				({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]?.setContentSize(width, 800),
				width,
			);
		const box = async (locator: Locator): Promise<{ width: number; bottom: number }> => {
			const found = await locator.boundingBox();
			return {
				width: Math.round(found?.width ?? 0),
				bottom: Math.round((found?.y ?? 0) + (found?.height ?? 0)),
			};
		};
		const sidebar = page.getByTestId('repository-sidebar');
		const inspector = page.getByTestId('extension-inspector-shell');
		const chat = page.getByTestId('transcript-pane');
		await expect(sidebar).toBeVisible();
		await expect(inspector).toHaveAttribute('data-inspector-drawer-open', 'true');

		await resize(900);
		await expect(sidebar).toBeHidden();
		await expect(inspector).toHaveAttribute('data-inspector-drawer-open', 'false');
		const filesRow = inspector.getByTestId('extension-inspector-gutter-row').first();
		await expect(filesRow).toBeVisible();
		await expect.poll(async () => (await box(chat)).bottom).toBe(800);
		const resting = await box(chat);
		expect(resting.width).toBeGreaterThan(480);
		await captureFlow(app, 'narrow-window-resting');

		await page.getByRole('button', { name: 'Show sidebar' }).click();
		await expect(sidebar).toBeVisible();
		await expect(page.getByRole('button', { name: 'Hide sidebar' })).toHaveAttribute(
			'aria-expanded',
			'true',
		);
		expect(await box(chat)).toEqual(resting);
		await captureFlow(app, 'narrow-window-sidebar');
		await page.keyboard.press('Escape');
		await expect(sidebar).toBeHidden();

		await filesRow.click();
		await expect(inspector).toHaveAttribute('data-inspector-drawer-open', 'true');
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible();
		expect(await box(chat)).toEqual(resting);
		await captureFlow(app, 'narrow-window-inspector');
		await page.getByTestId('chat-composer').click();
		await expect(inspector).toHaveAttribute('data-inspector-drawer-open', 'false');

		await filesRow.click();
		await page.getByRole('treeitem', { name: 'Open seed.txt' }).click();
		await expect(inspector).toHaveAttribute('data-inspector-drawer-open', 'false');
		await expect(
			page.getByTestId('chat-agent-tabs').getByRole('tab', { name: 'seed.txt', exact: true }),
		).toHaveAttribute('aria-selected', 'true');

		await resize(1280);
		await expect(sidebar).toBeVisible();
		await expect(inspector).toHaveAttribute('data-inspector-drawer-open', 'true');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
