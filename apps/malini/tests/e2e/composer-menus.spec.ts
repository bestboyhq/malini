import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('composer menus open on screen, move focus with the arrow keys, hand focus back to the prompt, and let an outside click land on its target', async () => {
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

		const options = page.getByRole('button', { name: 'Run options' });
		const optionsMenu = page.getByRole('menu', { name: 'Run options' });
		await options.click();
		await optionsMenu.getByRole('menuitemradio', { name: /^Auto/u }).click();
		await expect(optionsMenu).toBeHidden();
		await expect(page.getByRole('button', { name: 'Agent access: Auto' })).toBeVisible();
		await expect(input).toBeFocused();

		await expect(page.getByRole('button', { name: /^Report: / })).toBeHidden();
		await options.click();
		await optionsMenu.getByRole('menuitemradio', { name: /^Low/u }).click();
		await expect(optionsMenu).toBeHidden();
		await expect(page.getByRole('button', { name: 'Report: Low' })).toBeVisible();
		await expect(input).toBeFocused();

		await options.click();
		await optionsMenu.getByRole('menuitemcheckbox', { name: /^Plan mode/u }).click();
		const plan = page.getByRole('button', { name: 'Plan mode' });
		await expect(plan).toHaveAttribute('aria-pressed', 'true');
		await plan.click();
		await expect(plan).toBeHidden();
		await expect(input).toBeFocused();

		await options.click();
		await expect(optionsMenu).toBeInViewport();
		const focusedItem = optionsMenu.locator('[role^="menuitem"]:focus');
		await page.keyboard.press('ArrowDown');
		await expect(focusedItem).toHaveCount(1);
		const firstFocused = await focusedItem.innerText();
		await page.keyboard.press('ArrowDown');
		await expect(focusedItem).not.toHaveText(firstFocused);
		await page.keyboard.press('Escape');
		await expect(optionsMenu).toBeHidden();
		await expect(input).toBeFocused();

		const model = page.getByRole('button', { name: /^Model: / });
		const models = page.getByRole('listbox', { name: 'Claude models' });
		await model.click();
		await models.getByRole('option', { name: /^Opus/u }).click();
		await expect(models).toBeHidden();
		await expect(input).toBeFocused();

		await model.click();
		await expect(models).toBeVisible();
		await options.click();
		await expect(models).toBeHidden();
		await expect(optionsMenu).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(input).toBeFocused();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
