import { expect, test, type Locator, type Page } from '@playwright/test';
import { holdAgentRuns, sidebarStatus } from './fake-github';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	listEvents,
	seedTwoChats,
	selectChat,
	sendPrompt,
} from './harness';

function chatTab(page: Page, sessionId: string): Locator {
	return page.locator(`[data-testid="chat-agent-tab"][data-session-id="${sessionId}"]`);
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
