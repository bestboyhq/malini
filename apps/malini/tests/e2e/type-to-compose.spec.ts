import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('typing or pasting while nothing holds focus writes at the end of the composer draft', async () => {
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

		await input.blur();
		await page.evaluate(`(() => {
			const data = new DataTransfer();
			data.setData('text/plain', ' dictated words');
			document.activeElement.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
			);
		})()`);
		await expect(input).toBeFocused();
		await expect(input).toHaveText('Fix it @ dictated words');

		await page.getByRole('button', { name: /^Model: / }).click();
		await expect(page.getByRole('listbox', { name: 'Models' })).toBeVisible();
		await page.keyboard.press('x');
		await expect(input).not.toBeFocused();
		await expect(input).toHaveText('Fix it @ dictated words');
		await page.keyboard.press('Escape');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Enter, Backspace and arrows edit the draft after a click elsewhere, not after keyboard focus', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-draft-keys-ws',
			'Draft keys workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'hello');
		await expectAssistantReply(page);
		const input = page.getByTestId('chat-composer-input');
		const tab = page.getByTestId('chat-agent-tab').first();

		await input.click();
		await page.keyboard.type('Fix it', { delay: 10 });
		await input.blur();
		await page.keyboard.press('Backspace');
		await expect(input).toBeFocused();
		await expect(input).toHaveText('Fix i');
		await input.blur();
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type('X');
		await expect(input).toHaveText('Fix Xi');

		await tab.click();
		await expect(tab).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(input).toHaveText('');
		await expect(
			page.getByTestId('chat-message-bubble-user').filter({ hasText: 'Fix Xi' }),
		).toBeVisible();

		await input.click();
		await page.keyboard.type('Keep me', { delay: 10 });
		await tab.focus();
		await page.keyboard.press('Enter');
		await expect(input).not.toBeFocused();
		await expect(input).toHaveText('Keep me');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
