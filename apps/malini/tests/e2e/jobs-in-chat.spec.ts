import { expect, test } from '@playwright/test';
import { holdAgentRuns } from './fake-github';
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

test('a job run from the slash list waits in the composer tray instead of the chat, and its transcript opens and closes as a tab of its own', async () => {
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
		await sendPrompt(page, 'HANG');
		const submit = page.getByTestId('chat-composer-submit');
		await expect(submit).toHaveAccessibleName('Stop current run', { timeout: 20_000 });

		const input = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await input.click();
		await page.keyboard.type('/', { delay: 10 });
		const commands = page.getByRole('listbox', { name: 'Claude Code commands' });
		const jobs = page.getByRole('listbox', { name: 'Jobs' });
		await expect(
			commands.getByRole('option', { name: /^\/compact/u, selected: true }),
		).toBeVisible();
		await page.keyboard.press('ArrowDown');
		await expect(commands.getByRole('option', { selected: true })).toHaveCount(0);
		await expect(jobs.getByRole('option', { name: /^Fix checks/u, selected: true })).toBeVisible();
		await page.keyboard.press('ArrowDown');
		await expect(jobs.getByRole('option', { name: /^Fix checks/u, selected: true })).toHaveCount(0);
		await page.keyboard.press('ArrowUp');
		await expect(jobs.getByRole('option', { name: /^Fix checks/u, selected: true })).toBeVisible();
		await page.keyboard.press('Enter');

		const tray = page.getByRole('region', { name: 'Jobs (1)', exact: true });
		await expect(
			tray.getByRole('button', {
				name: 'Fix checks job, Queued. The transcript opens once the job starts',
			}),
		).toBeVisible({ timeout: 20_000 });
		await expect(input).toHaveText('');
		await expect(page.getByRole('article', { name: 'Job Fix checks' })).toHaveCount(0);
		await captureFlow(app, 'jobs-in-chat-queued');

		holdAgentRuns(app, true);
		await submit.click();
		const opener = tray.getByRole('link', { name: 'Open transcript: Fix checks job, Running' });
		await expect(opener).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('chat-agent-tab')).toHaveCount(1);
		await expect(page.getByRole('article', { name: 'Job Fix checks' })).toHaveCount(0);
		await opener.click();
		const jobTab = page.getByRole('tab', { name: /Job: Fix checks/u });
		await expect(jobTab).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
		await expect.poll(() => currentSessionId(page)).not.toBe(chat);
		const job = currentSessionId(page);

		holdAgentRuns(app, false);
		await expect(tray).toHaveCount(0, { timeout: 30_000 });
		await page.getByRole('button', { name: 'Close Job: Fix checks' }).click();
		await expect(jobTab).toHaveCount(0);
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(chat);
		expect((await listSessions(page, workstreamId)).map(({ id }) => id)).toContain(job);
		await expect(page.getByRole('region', { name: /^Jobs \(/u })).toHaveCount(0);
		await expect(page.getByRole('article', { name: 'Job Fix checks' })).toHaveCount(0);
		await captureFlow(app, 'jobs-in-chat-done');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
