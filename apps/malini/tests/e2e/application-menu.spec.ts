import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	launchMalini,
	listProjects,
	openWorkstream,
	seedWorkstream,
	type LaunchedApp,
} from './harness';

async function menuLabels(app: LaunchedApp, menu: string): Promise<string[]> {
	return app.electronApp.evaluate(
		({ Menu }, label) =>
			Menu.getApplicationMenu()
				?.items.find((item) => item.label === label)
				?.submenu?.items.filter((item) => item.type !== 'separator')
				.map((item) => item.label) ?? [],
		menu,
	);
}

async function choose(app: LaunchedApp, id: string): Promise<void> {
	await app.electronApp.evaluate(({ Menu }, item) => {
		const found = Menu.getApplicationMenu()?.getMenuItemById(item);
		if (!found) throw new Error(`the menu bar has no ${item}`);
		found.click();
	}, id);
}

function openedWorkstreamId(page: Page): string | null {
	return /#\/workstreams\/([^?/]+)/u.exec(page.url())?.[1] ?? null;
}

test('the File menu starts workstreams and chats, adds repositories, and closes Settings… to do it', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		expect(await menuLabels(app, 'File')).toEqual([
			'New Workstream',
			'New Chat',
			'Open Folder…',
			'Clone Repository…',
			'Close Window',
		]);
		expect(await menuLabels(app, 'Malini')).toContain('Settings…');

		const alpha = await createSourceRepo(app.root, 'alpha');
		const beta = await createSourceRepo(app.root, 'beta');
		await seedWorkstream(page, alpha, 'e2e-menu-alpha', 'Alpha work');
		await openWorkstream(page, 'e2e-menu-alpha');

		const previousChat = currentSessionId(page);
		await choose(app, 'new-chat');
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBe(previousChat);
		await expect(page.getByTestId('chat-fresh-session')).toBeVisible({ timeout: 20_000 });
		await captureFlow(app, 'application-menu-new-chat');

		await choose(app, 'new-workstream');
		await expect
			.poll(() => openedWorkstreamId(page), { timeout: 20_000 })
			.not.toBe('e2e-menu-alpha');
		const created = openedWorkstreamId(page);
		await expect(
			page.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${created}"]`),
		).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
		await captureFlow(app, 'application-menu-new-workstream');

		await choose(app, 'settings');
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(settings).toBeVisible();
		await captureFlow(app, 'application-menu-settings');
		const chatBehindSettings = currentSessionId(page);
		await choose(app, 'new-chat');
		await expect(settings).toHaveCount(0);
		await expect
			.poll(() => currentSessionId(page), { timeout: 20_000 })
			.not.toBe(chatBehindSettings);
		await expect(page.getByTestId('chat-fresh-session')).toBeVisible({ timeout: 20_000 });

		await app.electronApp.evaluate(({ dialog }, picked) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
		}, beta);
		await choose(app, 'open-folder');
		await expect(page).toHaveURL(/#\/repositories\//u, { timeout: 30_000 });
		await expect
			.poll(async () => (await listProjects(page)).map((project) => project.id).sort())
			.toEqual(['local__alpha', 'local__beta']);

		await choose(app, 'clone-repository');
		const clone = page.getByRole('dialog', { name: 'Clone GitHub repo' });
		await expect(clone).toBeVisible();
		await captureFlow(app, 'application-menu-clone');
		await page.keyboard.press('Escape');
		await expect(clone).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
