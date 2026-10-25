import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { BaseWindow, MessageBoxOptions } from 'electron';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

const MICROPHONE_PAGE = `<!doctype html><title>Microphone</title><button>Record</button><script>
let tries = 0;
document.querySelector('button').addEventListener('click', () =>
	navigator.mediaDevices
		.getUserMedia({ audio: true })
		.then(() => 'Allowed', (error) => error.name)
		.then((outcome) => {
			tries += 1;
			document.title = outcome + ' ' + tries;
		}),
);
</script>`;

test('a page that asks for the microphone asks you first in a sheet on the Malini window, and a page you refused is not asked again', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const questions = await electronApp.evaluateHandle(({ BrowserWindow, dialog }) => {
			const asked: Array<{
				message: string;
				detail: string | undefined;
				buttons: string[] | undefined;
				sheet: boolean;
			}> = [];
			dialog.showMessageBox = async (
				...args: [BaseWindow, MessageBoxOptions] | [MessageBoxOptions]
			) => {
				const options = args.length === 2 ? args[1] : args[0];
				asked.push({
					message: options.message,
					detail: options.detail,
					buttons: options.buttons,
					sheet: args.length === 2 && args[0] === BrowserWindow.getAllWindows()[0],
				});
				return { response: 1, checkboxChecked: false };
			};
			return asked;
		});
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-microphone-ws',
			'Browser microphone',
		);
		writeFileSync(join(seeded.worktree, 'microphone.html'), MICROPHONE_PAGE);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'New browser tab' }).click();
		const address = page.getByRole('textbox', { name: 'Page address' }).last();
		await address.fill('./microphone.html');
		await address.press('Enter');
		await expect(inspector.getByRole('tab', { name: 'Microphone', exact: true })).toBeVisible();
		const record = () =>
			electronApp.evaluate(async ({ webContents }) => {
				const microphonePage = webContents
					.getAllWebContents()
					.find((contents) => contents.getURL().endsWith('/microphone.html'));
				await microphonePage?.executeJavaScript('document.querySelector("button").click()', true);
			});

		await record();
		await expect(
			inspector.getByRole('tab', { name: 'NotAllowedError 1', exact: true }),
		).toBeVisible();
		expect(await questions.evaluate((asked) => asked)).toEqual([
			{
				message: 'Allow this worktree page to use your microphone?',
				detail: 'Malini remembers your answer until it quits.',
				buttons: ['Allow', 'Don’t Allow'],
				sheet: true,
			},
		]);

		await record();
		await expect(
			inspector.getByRole('tab', { name: 'NotAllowedError 2', exact: true }),
		).toBeVisible();
		expect(await questions.evaluate((asked) => asked.length)).toBe(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
