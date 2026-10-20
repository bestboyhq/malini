import { expect, test, type Page } from '@playwright/test';
import { holdAgentRuns, sidebarStatus } from './fake-github';
import {
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

async function goTo(page: Page, hash: string): Promise<void> {
	await page.evaluate((next) => {
		globalThis.location.hash = next;
	}, hash);
}

test('a prompt queued behind a run is sent once that run ends, even with the workstream off screen, and only once', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-queue-away-ws', 'Queue away');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the chat did not commit a session id');

		holdAgentRuns(app, true);
		await sendPrompt(page, 'Run held');
		const submit = page.getByTestId('chat-composer-submit');
		await expect(submit).toHaveAccessibleName('Stop current run');
		await page.keyboard.type('Queued later', { delay: 10 });
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('prompt-queue-item')).toContainText('Queued later');
		await expect(sidebarStatus(page, workstreamId)).toHaveAccessibleName(/Running/u);

		await goTo(page, '#/');
		await expect(page.getByTestId('transcript-pane')).toHaveCount(0, { timeout: 20_000 });
		holdAgentRuns(app, false);

		const userMessages = async (): Promise<string[]> =>
			(await listEvents(page, sessionId)).flatMap(({ event }) =>
				event.type === 'user.message' ? [String(event['text'])] : [],
			);
		const sent = ['EDIT:a.txt', 'Run held', 'Queued later'];
		await expect.poll(userMessages, { timeout: 20_000 }).toEqual(sent);

		await goTo(page, `#/workstreams/${workstreamId}?agent=${sessionId}`);
		await expect(
			page.locator(`[data-testid="chat-message-viewport"][data-session-id="${sessionId}"]`),
		).toBeVisible({ timeout: 20_000 });
		await expect(submit).toHaveAccessibleName('Send prompt', { timeout: 20_000 });
		await expect(page.getByTestId('prompt-queue')).toHaveCount(0);
		await page.waitForTimeout(1_500);
		expect(await userMessages()).toEqual(sent);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a queued prompt waits for a steered run that starts after the run it replaced ended', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-queue-steer-ws',
			'Queue steer',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the chat did not commit a session id');

		holdAgentRuns(app, true);
		await sendPrompt(page, 'Run held');
		const submit = page.getByTestId('chat-composer-submit');
		await expect(submit).toHaveAccessibleName('Stop current run');
		await page.keyboard.type('Queued first', { delay: 10 });
		await page.keyboard.press('Enter');
		const queued = page.getByTestId('prompt-queue-item');
		await expect(queued).toContainText('Queued first');

		await page.keyboard.type('Steer now DELAYED_START', { delay: 10 });
		await page.keyboard.press('ControlOrMeta+Enter');
		const userMessages = async (): Promise<string[]> =>
			(await listEvents(page, sessionId)).flatMap(({ event }) =>
				event.type === 'user.message' ? [String(event['text'])] : [],
			);
		await expect
			.poll(userMessages, { timeout: 20_000 })
			.toEqual(['EDIT:a.txt', 'Run held', 'Steer now DELAYED_START']);
		await page.waitForTimeout(2_500);
		await expect(queued).toContainText('Queued first');
		expect(await userMessages()).toEqual(['EDIT:a.txt', 'Run held', 'Steer now DELAYED_START']);

		holdAgentRuns(app, false);
		await expect
			.poll(userMessages, { timeout: 20_000 })
			.toEqual(['EDIT:a.txt', 'Run held', 'Steer now DELAYED_START', 'Queued first']);
		await expect(page.getByTestId('prompt-queue')).toHaveCount(0, { timeout: 20_000 });
		expectCleanConsole(app);
	} finally {
		holdAgentRuns(app, false);
		await app.close();
	}
});
