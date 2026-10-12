import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ArchivedWorkstreamDto } from '../../src/contract/repositories';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	startFreshChat,
} from './harness';

function tabRow(page: Page): Locator {
	return page.getByTestId('chat-agent-tabs');
}

function chatTab(page: Page, sessionId: string): Locator {
	return tabRow(page).locator(`[data-testid="chat-agent-tab"][data-session-id="${sessionId}"]`);
}

async function chatAbout(page: Page, prompt: string): Promise<string> {
	await sendPrompt(page, prompt);
	await expectAssistantReply(page);
	await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBeNull();
	return currentSessionId(page) ?? '';
}

async function closeTab(page: Page): Promise<void> {
	await page.keyboard.press('ControlOrMeta+w');
}

test('Cmd+W closes the current tab, then archives the workstream once no tab is left', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-close-tab-ws',
			'Close tab workstream',
		);
		await openWorkstream(page, workstreamId);
		const first = await chatAbout(page, 'first chat');
		await startFreshChat(page);
		const second = await chatAbout(page, 'second chat');
		expect(second).not.toBe(first);
		await page.getByRole('treeitem', { name: 'Open seed.txt' }).click();
		const file = tabRow(page).getByRole('tab', { name: 'seed.txt', exact: true });
		await expect(file).toHaveAttribute('aria-selected', 'true');
		await expect(tabRow(page).getByRole('tab')).toHaveCount(3);

		await closeTab(page);
		await expect(file).toHaveCount(0);
		await expect(chatTab(page, second)).toHaveAttribute('aria-selected', 'true');

		await closeTab(page);
		await expect(chatTab(page, second)).toHaveCount(0);
		await expect(chatTab(page, first)).toHaveAttribute('aria-selected', 'true');
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(first);

		await closeTab(page);
		await expect(chatTab(page, first)).toHaveCount(0);
		const fresh = tabRow(page).getByRole('tab', { name: 'New chat', exact: true });
		await expect(fresh).toHaveAttribute('aria-selected', 'true');
		await expect(tabRow(page).getByRole('tab')).toHaveCount(1);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'close-tab-shortcut-last-tab');

		await closeTab(page);
		await expect(page).toHaveTitle('malini · Repositories', { timeout: 20_000 });
		await expect(
			page.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`),
		).toHaveCount(0);
		await expect
			.poll(async () =>
				(await invoke<ArchivedWorkstreamDto[]>(page, 'repositories.list-archived-workstreams')).map(
					({ id }) => id,
				),
			)
			.toEqual([workstreamId]);
		await page.getByRole('button', { name: 'Archived workstreams' }).click();
		await expect(
			page
				.getByRole('menu', { name: 'Archived workstreams' })
				.getByRole('menuitem', { name: 'Restore First chat' }),
		).toBeVisible();
		await expect(page.getByTestId('toast')).toHaveCount(0);
		await captureFlow(app, 'close-tab-shortcut-archived');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
