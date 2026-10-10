import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('composer menus hand focus back to the prompt, and an outside click lands on its target', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-composer-menus-ws',
			'Composer menus workstream',
		);
		await openWorkstream(page, workstreamId);
		const input = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await expect(input).toBeVisible({ timeout: 20_000 });

		const access = page.getByRole('button', { name: 'Agent access' });
		const accessLevels = page.getByRole('listbox', { name: 'Agent access levels' });
		await access.click();
		await accessLevels.getByRole('option', { name: /^Auto/u }).click();
		await expect(accessLevels).toBeHidden();
		await expect(access).toHaveAccessibleName('Agent access');
		await expect(input).toBeFocused();

		await access.click();
		await expect(accessLevels).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(accessLevels).toBeHidden();
		await expect(input).toBeFocused();

		const model = page.getByRole('button', { name: /^Model: / });
		const models = page.getByRole('listbox', { name: 'Claude models' });
		await model.click();
		await models.getByRole('option', { name: /^Default/u }).click();
		await expect(models).toBeHidden();
		await expect(input).toBeFocused();

		await model.click();
		await expect(models).toBeVisible();
		await access.click();
		await expect(models).toBeHidden();
		await expect(accessLevels).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(input).toBeFocused();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
