import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	type LaunchedApp,
} from './harness';

const OPEN_FOLDER = 'Open a local repository folder';

declare global {
	var openFolderBusyLabels: string[];
}

test('opening a folder shows it working until the repository opens', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Meet your jobs' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();

		await pickFolder(app, await createSourceRepo(app.root, 'meadow'));
		await recordBusyLabels(page);
		await page.getByRole('button', { name: OPEN_FOLDER }).click();
		await expectScratchpadOf(page, 'meadow');
		expect(await busyLabels(page)).toContainEqual(expect.stringContaining('Opening…'));

		await page.getByRole('link', { name: 'Connect repository' }).click();
		await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();
		await pickFolder(app, await createSourceRepo(app.root, 'orchard'));
		await recordBusyLabels(page);
		await page.getByRole('button', { name: OPEN_FOLDER }).click();
		await expectScratchpadOf(page, 'orchard');
		expect(await busyLabels(page)).toContainEqual('Opening…');
		await captureFlow(app, 'open-folder-scratchpad');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function pickFolder(app: LaunchedApp, folder: string): Promise<void> {
	await app.electronApp.evaluate(({ dialog }, path) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
	}, folder);
}

async function recordBusyLabels(page: Page): Promise<void> {
	await page.locator('body').evaluate((body, name) => {
		const labels: string[] = [];
		globalThis.openFolderBusyLabels = labels;
		const view = body.ownerDocument.defaultView;
		if (!view) throw new Error('the repositories page has no window');
		new view.MutationObserver(() => {
			const button = body.querySelector(`button[aria-label="${name}"]`);
			if (button?.getAttribute('aria-busy') === 'true') labels.push(button.textContent.trim());
		}).observe(body, { childList: true, subtree: true, attributes: true });
	}, OPEN_FOLDER);
}

function busyLabels(page: Page): Promise<string[]> {
	return page.evaluate(() => globalThis.openFolderBusyLabels);
}

async function expectScratchpadOf(page: Page, repository: string): Promise<void> {
	await expect(page.getByTestId('repository-page')).toBeVisible({ timeout: 30_000 });
	await expect(
		page.getByRole('textbox', { name: new RegExp(`^Scratchpad for .*${repository}$`, 'u') }),
	).toBeVisible();
}
