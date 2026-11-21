import { expect, test, type Locator, type Page } from '@playwright/test';
import { holdAgentRuns, sidebarStatus } from './fake-github';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	listEvents,
	seedTwoChats,
	selectChat,
	sendPrompt,
	showInspector,
	startFreshChat,
	type LaunchedApp,
} from './harness';

function chatTab(page: Page, sessionId: string): Locator {
	return page.locator(`[data-testid="chat-agent-tab"][data-session-id="${sessionId}"]`);
}

function tabRow(page: Page): Locator {
	return page.getByTestId('chat-agent-tabs');
}

function tabOrder(page: Page): Promise<string[]> {
	return tabRow(page)
		.getByRole('tab')
		.evaluateAll((tabs) =>
			tabs.map((tab) => tab.getAttribute('data-session-id') ?? tab.textContent.trim()),
		);
}

async function chooseFromMenu(app: LaunchedApp, id: string): Promise<void> {
	await app.electronApp.evaluate(({ Menu }, item) => {
		const found = Menu.getApplicationMenu()?.getMenuItemById(item);
		if (!found) throw new Error(`the menu bar has no ${item}`);
		found.click();
	}, id);
}

function closeButtonOf(tab: Locator): Locator {
	return tab
		.locator('xpath=ancestor::div[.//*[@data-testid="chat-agent-tab-close"]][1]')
		.getByTestId('chat-agent-tab-close');
}

test('a chat tab marks an unsent draft, and a chat that finished out of sight as unread until it is read', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, chatA, chatB } = await seedTwoChats(
			page,
			source,
			'e2e-chat-tabs-marks-ws',
			'Chat tabs marks',
		);

		const input = page.getByTestId('chat-composer-input');
		await input.click();
		await page.keyboard.type('half a thought', { delay: 10 });
		await expect(chatTab(page, chatB)).toHaveAccessibleDescription('Unsent draft');
		await expect(chatTab(page, chatA)).toHaveAccessibleDescription('');
		await expect(sidebarStatus(page, workstreamId)).toHaveAccessibleName(/Unsent draft/u);
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await expect(chatTab(page, chatB)).toHaveAccessibleDescription('');

		await selectChat(page, chatA);
		holdAgentRuns(app, true);
		await sendPrompt(page, 'Keep going in A');
		await selectChat(page, chatB);
		holdAgentRuns(app, false);
		await expect(chatTab(page, chatA)).toHaveAccessibleDescription('Unread', { timeout: 20_000 });
		await expect(chatTab(page, chatB)).toHaveAccessibleDescription('');
		await captureFlow(app, 'chat-tabs-unread');

		await selectChat(page, chatA);
		await expect(chatTab(page, chatA)).toHaveAccessibleDescription('');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('closing a chat whose agent still runs asks first, keeps it on Keep working, and stops it on Stop and close', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, chatB } = await seedTwoChats(
			page,
			source,
			'e2e-chat-tabs-close-ws',
			'Chat tabs close',
		);
		await sendPrompt(page, 'HANG');
		const submit = page.getByTestId('chat-composer-submit');
		await expect(submit).toHaveAccessibleName('Stop current run');
		await expect(sidebarStatus(page, workstreamId)).toHaveAccessibleName(/Running/u);

		const confirmation = page.getByRole('dialog', { name: 'Close running chat' });
		await chatTab(page, chatB).hover();
		await closeButtonOf(chatTab(page, chatB)).click();
		await expect(confirmation).toBeVisible();
		await captureFlow(app, 'chat-tabs-close-running');
		await confirmation.getByRole('button', { name: 'Keep working' }).click();
		await expect(confirmation).toHaveCount(0);
		await expect(chatTab(page, chatB)).toBeVisible();
		await expect(submit).toHaveAccessibleName('Stop current run');

		await page.keyboard.press('ControlOrMeta+w');
		await expect(confirmation).toBeVisible();
		await confirmation.getByRole('button', { name: 'Stop and close' }).click();
		await expect(chatTab(page, chatB)).toHaveCount(0, { timeout: 20_000 });
		await expect
			.poll(async () => (await listEvents(page, chatB)).map(({ event }) => event.type))
			.toContain('run.failed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a closed chat waits under the clock, reopens from there or with Cmd+Shift+T where it was, and keeps what it said', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { chatA, chatB } = await seedTwoChats(
			page,
			source,
			'e2e-chat-tabs-reopen-ws',
			'Chat tabs reopen',
		);
		const history = page.getByRole('button', { name: 'Recently closed chats' });
		const menu = page.getByRole('menu', { name: 'Recently closed chats' });
		const closed = menu.getByRole('menuitem');

		await history.click();
		await expect(menu).toContainText('Closed chats will be there in case you need them');
		await expect(closed).toHaveCount(0);
		await page.keyboard.press('Escape');

		await page.keyboard.press('ControlOrMeta+w');
		await expect(chatTab(page, chatB)).toHaveCount(0);
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(chatA);
		await startFreshChat(page);
		await page.keyboard.press('ControlOrMeta+w');
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(chatA);

		await history.click();
		await expect(closed).toHaveCount(1);
		await expect(closed.first()).toHaveAttribute('data-session-id', chatB);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'chat-tabs-recently-closed');
		await closed.first().click();
		await expect(menu).toHaveCount(0);
		await expect(chatTab(page, chatB)).toHaveAttribute('aria-selected', 'true');
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(chatB);
		await expectAssistantReply(page);

		await selectChat(page, chatA);
		const order = await tabOrder(page);
		expect(order).toEqual([chatA, chatB]);
		await page.keyboard.press('ControlOrMeta+w');
		await expect(chatTab(page, chatA)).toHaveCount(0);
		const reopen = await app.electronApp.evaluate(
			({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('reopen-chat')?.accelerator,
		);
		expect(reopen).toBe('CommandOrControl+Shift+T');
		await chooseFromMenu(app, 'reopen-chat');
		await expect(chatTab(page, chatA)).toHaveAttribute('aria-selected', 'true');
		await expect.poll(() => tabOrder(page)).toEqual(order);
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(chatA);
		await expectAssistantReply(page);

		await history.click();
		await expect(closed).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('chat and file tabs share one order, dragged or moved with Option and an arrow, that stays after a reload', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedTwoChats(page, source, 'e2e-chat-tabs-order-ws', 'Chat tabs order');
		await showInspector(page);
		await page.getByRole('treeitem', { name: 'Open seed.txt' }).click();
		const file = tabRow(page).getByRole('tab', { name: 'seed.txt', exact: true });
		await expect(file).toHaveAttribute('aria-selected', 'true');
		const [first = '', second = '', third = ''] = await tabOrder(page);
		expect(third).toBe('seed.txt');

		const dragged = chatTab(page, first);
		const from = await dragged.boundingBox();
		const to = await file.boundingBox();
		if (!from || !to) throw new Error('the tabs have no box to drag between');
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width - 4, to.y + to.height / 2, { steps: 12 });
		await captureFlow(app, 'chat-tabs-dragging');
		await page.mouse.up();
		await expect.poll(() => tabOrder(page)).toEqual([second, 'seed.txt', first]);
		await expect(file).toHaveAttribute('aria-selected', 'true');
		await expect(dragged).toHaveAttribute('aria-selected', 'false');

		await file.focus();
		await page.keyboard.press('Alt+ArrowLeft');
		await expect.poll(() => tabOrder(page)).toEqual(['seed.txt', second, first]);
		await expect(file).toBeFocused();

		await page.reload();
		await expect
			.poll(() => tabOrder(page), { timeout: 20_000 })
			.toEqual(['seed.txt', second, first]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
