import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const GRABBY_PAGE = [
	'<!doctype html><title>Grabby prototype</title>',
	'<h1>Grabby prototype</h1>',
	'<input aria-label="Prototype field">',
	'<script>',
	"const field = document.querySelector('input');",
	'field.focus();',
	'setInterval(() => {',
	'	window.focus();',
	'	field.select();',
	'	field.focus();',
	'}, 200);',
	'</script>',
].join('\n');

test("a live prototype in the chat or the browser tab never takes the composer's focus", async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'composer-focus');
		const seeded = await seedWorkstream(page, source, 'e2e-composer-focus', 'Composer focus');
		mkdirSync(join(seeded.worktree, '.context'), { recursive: true });
		writeFileSync(join(seeded.worktree, '.context', 'grabby.html'), GRABBY_PAGE);
		writeFileSync(
			join(seeded.worktree, 'report.md'),
			['![Grabby prototype](.context/grabby.html)', '', 'Outcome: A prototype.'].join('\n'),
		);
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'Open it BROWSER_OPEN:./.context/grabby.html');
		await expect(
			page
				.getByRole('region', { name: 'Inspector' })
				.getByRole('tab', { name: 'Grabby prototype' }),
		).toBeVisible({ timeout: 20_000 });
		const typeInto = Buffer.from(
			JSON.stringify({ action: 'type', selector: 'input', text: 'agent', submit: false }),
		).toString('base64url');
		await sendPrompt(page, `Type BROWSER_REQUEST:${typeInto}`);
		await expect(page.getByText('Typed into `input`')).toBeVisible({ timeout: 20_000 });
		await sendPrompt(page, 'Show me REPLY_FILE:report.md');
		const prototype = page.locator('iframe[title="Grabby prototype"]').contentFrame();
		await expect(prototype.getByRole('heading', { name: 'Grabby prototype' })).toBeVisible({
			timeout: 30_000,
		});

		const composer = page.getByTestId('chat-composer-input');
		await page.keyboard.type('Still', { delay: 20 });
		await page.waitForTimeout(1_000);
		await page.keyboard.type(' mine', { delay: 20 });
		await expect(composer).toBeFocused();
		await expect(composer).toHaveText('Still mine');

		await expect(prototype.getByRole('textbox', { name: 'Prototype field' })).toHaveValue('');
		await captureFlow(app, 'composer-focus-prototype');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
