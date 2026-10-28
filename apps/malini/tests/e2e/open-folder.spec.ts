import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	git,
	launchMalini,
	listProjects,
	type LaunchedApp,
} from './harness';

const OPEN_FOLDER = 'Open a local repository folder';

declare global {
	var openFolderBusyLabels: string[];
}

test('opening a folder lands on its scratchpad and clones it in the background', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Meet your jobs' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
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
		await expect
			.poll(async () => (await listProjects(page)).map((project) => project.id).sort())
			.toEqual(['local__meadow', 'local__orchard']);
		await captureFlow(app, 'open-folder-scratchpad');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a folder whose clone fails still opens, and offers a retry', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		allowedDiagnostics: [/'upstream' does not appear to be a git repository/u],
	});
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Meet your jobs' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();

		const thicket = await createSourceRepo(app.root, 'thicket');
		const upstream = join(app.root, 'upstream');
		await git(thicket, ['remote', 'add', 'origin', upstream]);
		await pickFolder(app, thicket);
		await page.getByRole('button', { name: OPEN_FOLDER }).click();
		await expectScratchpadOf(page, 'thicket');

		const failure = page.getByRole('alert').filter({ hasText: 'Could not clone this repository' });
		await expect(failure).toBeVisible({ timeout: 30_000 });
		await expect(failure).toContainText("'upstream' does not appear to be a git repository");
		await captureFlow(app, 'open-folder-clone-failed');

		await createSourceRepo(app.root, 'upstream');
		await failure.getByRole('button', { name: 'Retry' }).click();
		await expect(failure).toHaveCount(0, { timeout: 30_000 });
		await expect
			.poll(async () => (await listProjects(page)).map((project) => project.id))
			.toEqual(['local__upstream']);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a repository cannot be removed while it clones, and can once the clone fails', async () => {
	test.setTimeout(120_000);
	const silent = await silentGitServer();
	const app = await launchMalini({ allowedDiagnostics: [/repositories\.create-repository/u] });
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Meet your jobs' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();

		const grove = await createSourceRepo(app.root, 'grove');
		await git(grove, ['remote', 'add', 'origin', `${silent.url}/e2e/grove.git`]);
		await pickFolder(app, grove);
		await page.getByRole('button', { name: OPEN_FOLDER }).click();
		await expectScratchpadOf(page, 'grove');
		await expect.poll(() => silent.sockets.size).toBeGreaterThan(0);

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		await sidebar.getByRole('link', { name: /grove$/u }).click({ button: 'right' });
		const remove = page
			.getByRole('menu', { name: 'Repository actions' })
			.getByRole('menuitem', { name: 'Remove e2e/grove' });
		await expect(remove).toHaveText('Remove after the clone finishes');
		await expect(remove).toBeDisabled();
		await captureFlow(app, 'open-folder-remove-while-cloning');
		await page.keyboard.press('Escape');

		for (const socket of silent.sockets) socket.destroy();
		const failure = page.getByRole('alert').filter({ hasText: 'Could not clone this repository' });
		await expect(failure).toBeVisible({ timeout: 30_000 });
		await failure.getByRole('button', { name: 'Remove e2e/grove' }).click();
		await failure.getByRole('button', { name: 'Confirm remove e2e/grove' }).click();
		await expect(page.getByTestId('repository-page')).toHaveCount(0);
		await expect(sidebar.getByRole('link', { name: /grove$/u })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
		silent.server.close();
	}
});

async function silentGitServer(): Promise<{ server: Server; sockets: Set<Socket>; url: string }> {
	const sockets = new Set<Socket>();
	const server = createServer(() => {});
	server.on('connection', (socket) => sockets.add(socket));
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (typeof address !== 'object' || address === null) throw new Error('no port to clone from');
	return { server, sockets, url: `http://127.0.0.1:${address.port}` };
}

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
