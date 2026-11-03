import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	GITHUB_REPOSITORIES_FIXTURE,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openRepositoriesPage,
	passSetup,
} from './harness';

test('⌘K runs a command or finds any repository you work on, on GitHub or only on this Mac, and opens it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const hutch = await createSourceRepo(app.root, 'hutch');
		const burrow = await createSourceRepo(app.root, 'burrow');
		const alpha = await createSourceRepo(app.root, 'alpha');
		writeFileSync(
			join(app.home, GITHUB_REPOSITORIES_FIXTURE),
			JSON.stringify([
				{ full_name: 'e2e/hutch', clone_url: `file://${hutch}`, description: 'Rabbits live here.' },
			]),
		);
		await app.electronApp.evaluate(({ dialog }, picked) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
		}, alpha);
		await passSetup(page);
		await openRepositoriesPage(page);

		const center = page.getByRole('dialog', { name: 'Command center' });
		const commands = center.getByRole('combobox', { name: 'Command or repository' });
		const search = center.getByRole('combobox', { name: 'Search repositories' });
		const options = center.getByRole('option');

		await page.keyboard.press('ControlOrMeta+k');
		await expect(commands).toBeFocused();
		await expect(options).toHaveText([
			/^\s*Find a repository\s*$/u,
			/^\s*New repository\s*$/u,
			/^\s*Open a folder\s*⌘O\s*$/u,
			/^\s*Settings\s*⌘,\s*$/u,
		]);
		const second = await options.nth(1).boundingBox();
		if (!second) throw new Error('New repository has no box');
		await page.keyboard.press('ControlOrMeta+k');
		await expect(center).toHaveCount(0);
		await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
		await page.keyboard.press('ControlOrMeta+k');
		await expect(options.first()).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
		await page.mouse.move(second.x + second.width / 2 + 8, second.y + second.height / 2);
		await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
		await commands.fill('find');
		await expect(options).toHaveText(['Find a repository']);
		await page.keyboard.press('Enter');
		await expect(search).toBeFocused();
		await expect(options.filter({ hasText: 'e2e/hutch' })).toHaveAttribute('aria-selected', 'true');
		await captureFlow(app, 'command-center-find');
		await page.keyboard.press('Backspace');
		await expect(commands).toBeFocused();
		await expect(commands).toHaveValue('');
		await page.keyboard.press('ControlOrMeta+k');
		await expect(center).toHaveCount(0);

		await page.keyboard.press('ControlOrMeta+k');
		await commands.fill('folder');
		await page.keyboard.press('Enter');
		await expect(center).toHaveCount(0);
		await expectScratchpadOf(page, 'alpha');

		await page.keyboard.press('ControlOrMeta+k');
		await commands.fill('rabbits');
		await expect(center.getByRole('group', { name: 'Your repositories' })).toContainText(
			'e2e/hutch',
		);
		await page.keyboard.press('Enter');
		await expectScratchpadOf(page, 'hutch');
		await expect(center).toHaveCount(0);

		await page.keyboard.press('ControlOrMeta+k');
		await page.keyboard.press('Enter');
		await search.fill('alpha');
		await expect(options).toHaveCount(1);
		await page.keyboard.press('Enter');
		await expectScratchpadOf(page, 'alpha');
		await expect(center).toHaveCount(0);

		await page.keyboard.press('ControlOrMeta+k');
		await expect(commands).toBeFocused();
		await page.getByRole('textbox', { name: 'Scratchpad for alpha' }).focus();
		await expect(commands).toBeFocused();
		await commands.fill(`file://${burrow}`);
		await expect(options).toHaveText([`Open file://${burrow}`]);
		await page.keyboard.press('Enter');
		await expectScratchpadOf(page, 'burrow');
		await expect(center).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function expectScratchpadOf(page: Page, repository: string): Promise<void> {
	await expect(
		page.getByRole('textbox', { name: new RegExp(`^Scratchpad for .*${repository}$`, 'u') }),
	).toBeVisible({ timeout: 30_000 });
}
