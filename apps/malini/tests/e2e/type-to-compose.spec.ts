import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('typing while nothing holds focus writes at the end of the composer draft', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-type-to-compose-ws',
			'Type to compose workstream',
		);
		await openWorkstream(page, workstreamId);
		const input = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await expect(input).toBeVisible({ timeout: 20_000 });

		await input.blur();
		await page.keyboard.type('Fix it ', { delay: 10 });
		await expect(input).toBeFocused();
		await expect(input).toHaveText('Fix it');

		await input.blur();
		await page.keyboard.press('Space');
		await expect(input).not.toBeFocused();

		await page.keyboard.press('@');
		await expect(page.getByRole('dialog', { name: 'Add workstream context' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(input).toBeFocused();
		await expect(input).toHaveText('Fix it @');

		await page.getByRole('button', { name: /^Model: / }).click();
		await expect(page.getByRole('listbox', { name: 'Claude models' })).toBeVisible();
		await page.keyboard.press('x');
		await expect(input).not.toBeFocused();
		await expect(input).toHaveText('Fix it @');
		await page.keyboard.press('Escape');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
