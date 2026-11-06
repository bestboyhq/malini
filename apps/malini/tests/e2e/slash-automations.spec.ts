import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('a typed slash opens the automation list while the prompt keeps the text, the focus and the query', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-slash-automations-ws',
			'Slash automations workstream',
		);
		await openWorkstream(page, workstreamId);
		const input = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await expect(input).toBeVisible({ timeout: 20_000 });
		const picker = page.getByTestId('automation-picker');
		const automations = page.getByRole('listbox', { name: 'Automations' });

		await input.click();
		await page.keyboard.type('Then /', { delay: 10 });
		await expect(automations).toBeVisible();
		await expect(automations).toBeInViewport();
		await expect(input).toBeFocused();
		await expect(page.getByRole('textbox', { name: 'Find an automation' })).toHaveCount(0);

		await page.keyboard.type('main', { delay: 10 });
		await expect(input).toHaveText('Then /main');
		await expect(automations.getByRole('option')).toHaveCount(1);
		const selected = automations.getByRole('option', {
			name: /^Update from main/u,
			selected: true,
		});
		await expect(selected).toBeVisible();
		await expect(input).toHaveAttribute(
			'aria-activedescendant',
			(await selected.getAttribute('id')) ?? '',
		);

		await page.keyboard.press('Escape');
		await expect(picker).toBeHidden();
		await expect(input).toBeFocused();
		await expect(input).toHaveText('Then /main');
		await expect(input).not.toHaveAttribute('aria-activedescendant');

		await page.keyboard.type(' /zz', { delay: 10 });
		await expect(picker.getByRole('status')).toHaveText('No automation matches “/zz”');
		await page.keyboard.press('Space');
		await expect(picker).toBeHidden();
		await expect(input).toBeFocused();

		await page.keyboard.type('/', { delay: 10 });
		await expect(automations).toBeVisible();
		await page.keyboard.press('Backspace');
		await expect(picker).toBeHidden();
		await expect(input).toHaveText('Then /main /zz');

		await page.getByRole('button', { name: 'Add to prompt' }).click();
		await page.getByRole('menuitem', { name: 'Run an automation' }).click();
		await expect(page.getByRole('dialog', { name: 'Run an automation' })).toBeVisible();
		await expect(page.getByRole('searchbox', { name: 'Find an automation' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(picker).toBeHidden();
		await expect(input).toBeFocused();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
