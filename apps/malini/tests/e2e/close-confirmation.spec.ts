import { expect, test, type ElectronApplication } from '@playwright/test';
import { captureFlow, expectCleanConsole, launchMalini } from './harness';

async function closeWindow(electronApp: ElectronApplication): Promise<void> {
	await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
}

async function openWindows(electronApp: ElectronApplication): Promise<number> {
	return electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

test('closing the window asks first, Keep working keeps it open, and Close Malini closes it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		await expect(page).toHaveTitle('Malini · Repositories');
		const dialog = page.getByRole('dialog', { name: 'Close Malini' });

		await expect(async () => {
			await closeWindow(electronApp);
			await expect(dialog).toBeVisible({ timeout: 1_000 });
		}).toPass({ timeout: 20_000 });
		await expect(dialog).toContainText('Nothing Malini started is still running.');
		await captureFlow(app, 'close-confirmation');

		await dialog.getByRole('button', { name: 'Keep working' }).click();
		await expect(dialog).toHaveCount(0);
		expect(await openWindows(electronApp)).toBe(1);

		await closeWindow(electronApp);
		await expect(dialog).toBeVisible();
		expectCleanConsole(app);
		await dialog.getByRole('button', { name: 'Close Malini' }).click();
		await expect.poll(() => openWindows(electronApp), { timeout: 30_000 }).toBe(0);
	} finally {
		await app.close();
	}
});
