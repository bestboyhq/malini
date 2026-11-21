import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	expectPicker,
	listProjects,
	type LaunchedApp,
} from './harness';
import { osFor } from '../../src/lib/shared/os/domain/os';

const FOLDER_DOOR = `A folder on this ${osFor(process.platform).machine}`;

const OPEN_FOLDER = 'Open a local repository folder';

declare global {
	var openFolderBusyLabels: string[];
}

test('the first folder you open starts a workstream in it, and so does a later one', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await expectPicker(page);

		await pickFolder(app, await createSourceRepo(app.root, 'meadow'));
		await recordBusyLabels(page);
		await page
			.getByRole('region', { name: 'Your repositories' })
			.getByRole('button', { name: FOLDER_DOOR })
			.click();
		await expect(page).toHaveURL(/#\/workstreams\//u, { timeout: 30_000 });
		await expect(
			page
				.getByRole('navigation', { name: 'Connected repositories' })
				.getByTestId('sidebar-workstream'),
		).toHaveAttribute('aria-current', 'page');
		expect(await busyLabels(page)).toContainEqual(expect.stringContaining('Opening…'));

		await page.evaluate(() => (globalThis.location.hash = '#/'));
		await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();
		await pickFolder(app, await createSourceRepo(app.root, 'orchard'));
		await recordBusyLabels(page);
		await page.getByRole('button', { name: OPEN_FOLDER }).click();
		await expect(
			page
				.getByRole('navigation', { name: 'Connected repositories' })
				.getByTestId('sidebar-workstream'),
		).toHaveCount(2, { timeout: 30_000 });
		await expect(page).toHaveURL(/#\/workstreams\//u);
		await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 30_000 });
		expect(await busyLabels(page)).toContainEqual(OPEN_FOLDER);
		await expect
			.poll(async () => (await repositoryIds(page)).sort())
			.toEqual(['local__meadow', 'local__orchard']);
		await captureFlow(app, 'open-folder-later-workstream');
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
	await page.locator('body').evaluate((body) => {
		const labels: string[] = [];
		globalThis.openFolderBusyLabels = labels;
		const view = body.ownerDocument.defaultView;
		if (!view) throw new Error('the repositories page has no window');
		new view.MutationObserver(() => {
			for (const button of body.querySelectorAll('button[aria-busy="true"]')) {
				labels.push(button.getAttribute('aria-label') ?? button.textContent.trim());
			}
		}).observe(body, { childList: true, subtree: true, attributes: true });
	});
}

function busyLabels(page: Page): Promise<string[]> {
	return page.evaluate(() => globalThis.openFolderBusyLabels);
}

async function repositoryIds(page: Page): Promise<string[]> {
	return (await listProjects(page)).map((project) => project.id);
}
