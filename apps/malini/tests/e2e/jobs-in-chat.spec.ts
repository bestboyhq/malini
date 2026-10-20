import { expect, test, type Locator } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	listSessions,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

async function top(locator: Locator): Promise<number> {
	const box = await locator.boundingBox();
	if (!box) throw new Error('the row is not laid out');
	return box.y;
}

test('a job run from the slash list lands in the chat after the turn it followed, and its transcript opens and closes as a tab of its own', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-chat-jobs-ws', 'Chat jobs');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		const chat = currentSessionId(page);
		if (!chat) throw new Error('the chat did not commit a session id');

		const input = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await input.click();
		await page.keyboard.type('/', { delay: 10 });
		const jobs = page.getByRole('listbox', { name: 'Jobs' });
		await expect(jobs.getByRole('option', { name: /^Fix checks/u, selected: true })).toBeVisible();
		await page.keyboard.press('ArrowDown');
		await expect(jobs.getByRole('option', { name: /^Fix checks/u, selected: true })).toHaveCount(0);
		await page.keyboard.press('ArrowUp');
		await expect(jobs.getByRole('option', { name: /^Fix checks/u, selected: true })).toBeVisible();
		await page.keyboard.press('Enter');

		const card = page.getByRole('article', { name: 'Job Fix checks' });
		await expect(card).toBeVisible({ timeout: 20_000 });
		await expect(input).toHaveText('');
		await expect(card).toContainText('Done', { timeout: 30_000 });
		await expect(page.getByTestId('chat-agent-tab')).toHaveCount(1);

		await sendPrompt(page, 'Second question');
		const replies = page.getByText('Hello from the fake bridge', { exact: true });
		await expect(replies).toHaveCount(2, { timeout: 30_000 });
		const cardTop = await top(card);
		expect(cardTop).toBeGreaterThan(await top(replies.first()));
		expect(cardTop).toBeLessThan(await top(replies.last()));
		await captureFlow(app, 'jobs-in-chat-card');

		await card.getByRole('link', { name: 'Open transcript' }).click();
		const jobTab = page.getByRole('tab', { name: /Job: Fix checks/u });
		await expect(jobTab).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
		await expect.poll(() => currentSessionId(page)).not.toBe(chat);
		const job = currentSessionId(page);

		await page.getByRole('button', { name: 'Close Job: Fix checks' }).click();
		await expect(jobTab).toHaveCount(0);
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(chat);
		expect((await listSessions(page, workstreamId)).map(({ id }) => id)).toContain(job);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
