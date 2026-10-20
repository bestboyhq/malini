import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedTwoChats,
	startFreshChat,
} from './harness';

test('closing a new chat before sending returns to the latest chat of the workstream', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { chatB } = await seedTwoChats(page, source, 'e2e-close-fresh-ws', 'Close fresh');

		await startFreshChat(page);
		const fresh = currentSessionId(page);
		await page.getByRole('button', { name: 'Close New chat' }).click();

		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(chatB);
		await expect(page.getByRole('button', { name: 'Close New chat' })).toHaveCount(0);
		expect(fresh).not.toBe(chatB);
		await expect(
			page.locator(`[data-testid="chat-message-viewport"][data-session-id="${chatB}"]`),
		).toBeVisible({ timeout: 20_000 });

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a link to a chat that no longer exists opens the latest chat of its workstream', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, chatB } = await seedTwoChats(
			page,
			source,
			'e2e-stale-link-ws',
			'Stale link',
		);

		await openWorkstream(page, workstreamId, 'session-that-is-gone');

		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(chatB);
		await expect(
			page.locator(`[data-testid="chat-message-viewport"][data-session-id="${chatB}"]`),
		).toBeVisible({ timeout: 20_000 });

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
