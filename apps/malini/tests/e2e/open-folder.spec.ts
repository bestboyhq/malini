import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	expectPicker,
	listProjects,
	type LaunchedApp,
} from './harness';

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
			.getByRole('button', { name: 'A folder on this Mac' })
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

test('a folder with no git history gets a first commit of its files and opens a workstream', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await expectPicker(page);
		const folder = join(app.root, 'pantry');
		mkdirSync(join(folder, 'node_modules', 'jam'), { recursive: true });
		writeFileSync(join(folder, 'recipes.md'), '# Plum jam\n');
		writeFileSync(join(folder, 'node_modules', 'jam', 'index.js'), 'export {};\n');
		writeFileSync(join(folder, '.env'), 'PANTRY_KEY=fig\n');

		await pickFolder(app, folder);
		await page
			.getByRole('region', { name: 'Your repositories' })
			.getByRole('button', { name: 'A folder on this Mac' })
			.click();
		await expect(page).toHaveURL(/#\/workstreams\//u, { timeout: 30_000 });
		await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 30_000 });
		await expect.poll(() => repositoryIds(page), { timeout: 30_000 }).toEqual(['local__pantry']);
		await expect(setupStep(page, 'Copy failed')).toHaveCount(0);
		expect(gitOutput(folder, ['ls-files'])).toEqual(['recipes.md']);
		expect(gitOutput(folder, ['log', '--format=%s'])).toEqual(['Initial commit']);
		expect(gitOutput(folder, ['status', '--porcelain', '--untracked-files=normal'])).toEqual([
			'?? .env',
			'?? node_modules/',
		]);
		await captureFlow(app, 'open-folder-without-history');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a folder inside another repository names that repository and stays as it is', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: [/inside the git repository meadow/u] });
	try {
		const { page } = app;
		await expectPicker(page);
		const notes = join(await createSourceRepo(app.root, 'meadow'), 'notes');
		mkdirSync(notes);
		writeFileSync(join(notes, 'field.md'), '# Clover\n');

		await pickFolder(app, notes);
		await page
			.getByRole('region', { name: 'Your repositories' })
			.getByRole('button', { name: 'A folder on this Mac' })
			.click();
		await expect(setupStep(page, 'Copy failed')).toContainText(
			'This folder is inside the git repository meadow. Open meadow instead.',
			{ timeout: 30_000 },
		);
		expect(existsSync(join(notes, '.git'))).toBe(false);
		await captureFlow(app, 'open-folder-inside-repository');
	} finally {
		await app.close();
	}
});

function setupStep(page: Page, label: string): Locator {
	return page
		.getByRole('list', { name: 'Workstream setup' })
		.getByRole('listitem')
		.filter({ hasText: label });
}

function gitOutput(folder: string, args: readonly string[]): string[] {
	return execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8' })
		.split('\n')
		.filter(Boolean);
}

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
