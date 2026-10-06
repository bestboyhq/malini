import { expect, test } from '@playwright/test';
import { invoke, launchMalini, type RuntimeInfo } from './harness';

test('the built app opens a window on a runtime whose SQLite is the bundled one', async () => {
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;

		await expect(page).toHaveTitle('malini · Repositories');
		await expect(page.getByRole('heading', { name: 'Set up malini' })).toBeVisible();

		const runtime = await invoke<RuntimeInfo>(page, 'app.runtime-info', undefined);
		expect(runtime.app).toBe('0.1.0');
		expect(runtime.node).toMatch(/^24\./u);
		expect(runtime.sqlite).toMatch(/^\d+\.\d+\.\d+$/u);

		const bundledAppVersion = await electronApp.evaluate(({ app: electronAppVersion }) =>
			electronAppVersion.getVersion(),
		);
		expect(bundledAppVersion).toBe('0.1.0');
	} finally {
		await app.close();
	}
});

test('a test run keeps the app off the screen of whoever is using the machine', async () => {
	const app = await launchMalini();
	try {
		await expect(app.page).toHaveTitle('malini · Repositories');
		const onScreen = await app.electronApp.evaluate(({ BrowserWindow, screen }) => {
			const [window] = BrowserWindow.getAllWindows();
			if (!window) throw new Error('malini opened no window');
			const bounds = window.getBounds();
			return screen.getAllDisplays().map(({ bounds: display }) => {
				const width = Math.min(bounds.x + bounds.width, display.x + display.width);
				const height = Math.min(bounds.y + bounds.height, display.y + display.height);
				return (
					Math.max(0, width - Math.max(bounds.x, display.x)) *
					Math.max(0, height - Math.max(bounds.y, display.y))
				);
			});
		});
		expect(Math.max(...onScreen)).toBeLessThanOrEqual(800);
	} finally {
		await app.close();
	}
});
