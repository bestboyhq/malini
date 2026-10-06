import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('the model picker is one button that opens and closes its list from the keyboard', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-model-picker-ws',
			'Model picker workstream',
		);
		await openWorkstream(page, workstreamId);

		const picker = page.getByRole('button', { name: /^Model: / });
		await expect(picker).toHaveCount(1, { timeout: 20_000 });
		await app.electronApp.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.setSize(900, 700),
		);
		await expect(picker).toHaveAccessibleName('Model: Default');
		const models = page.getByRole('listbox', { name: 'Claude models' });

		await picker.focus();
		await page.keyboard.press('Enter');
		await expect(models).toBeVisible();
		await expect(picker).toHaveAttribute('aria-expanded', 'true');
		await expect(models.getByRole('option', { name: /^Default/u })).toHaveAttribute(
			'aria-selected',
			'true',
		);

		await page.keyboard.press('Escape');
		await expect(models).toBeHidden();
		await expect(picker).toBeFocused();
		await expect(picker).toHaveAttribute('aria-expanded', 'false');

		await page.keyboard.press('Space');
		await expect(models).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(models).toBeHidden();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
