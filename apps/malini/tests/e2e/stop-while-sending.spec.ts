import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	expectStoppedChatIsNeutral,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';

test('Stop pressed while the prompt is still being sent stops that run', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const sessionId = await chatWithOneReply(app, 'e2e-stop-ws');

		await sendPrompt(page, 'EDIT:b.txt HANG');
		const submit = page.getByTestId('chat-composer-submit');
		await expect(submit).toHaveAccessibleName('Stop current run');
		await submit.click();

		await expectRunStoppedForGood(page, sessionId);
		await expectStoppedChatIsNeutral(page, sessionId);
		await captureFlow(app, 'stop-while-sending');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Stop pressed on a running agent ends the run without calling it a failure', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const sessionId = await chatWithOneReply(app, 'e2e-stop-running-ws');

		await sendPrompt(page, 'EDIT:b.txt HANG');
		await expect(page.getByTestId('run-activity-file').filter({ hasText: 'b.txt' })).toBeVisible({
			timeout: 20_000,
		});
		await page.getByTestId('chat-composer-submit').click();

		await expectRunStoppedForGood(page, sessionId);
		await expectStoppedChatIsNeutral(page, sessionId);
		await captureFlow(app, 'stop-running-agent');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function chatWithOneReply(app: LaunchedApp, workstreamId: string): Promise<string> {
	const source = await createSourceRepo(app.root);
	await seedWorkstream(app.page, source, workstreamId, 'Stop workstream');
	await openWorkstream(app.page, workstreamId);
	await sendPrompt(app.page, 'EDIT:a.txt');
	await expectAssistantReply(app.page);
	const sessionId = currentSessionId(app.page);
	if (!sessionId) throw new Error('the chat did not commit a session id');
	return sessionId;
}

async function expectRunStoppedForGood(page: Page, sessionId: string): Promise<void> {
	const submit = page.getByTestId('chat-composer-submit');
	await expect(submit).toHaveAccessibleName('Send prompt', { timeout: 15_000 });
	const [runId] = (await listEvents(page, sessionId))
		.filter(({ event }) => event.type === 'user.message')
		.slice(-1)
		.map((entry) => entry.runId);
	if (!runId) throw new Error('the stopped prompt left no user message');
	const runEvents = async (): Promise<string[]> =>
		(await listEvents(page, sessionId))
			.filter((entry) => entry.runId === runId)
			.map(({ event }) => event.type);
	await expect.poll(runEvents, { timeout: 15_000 }).toContain('run.failed');
	const settled = await runEvents();
	expect(settled).not.toContain('run.completed');
	await page.waitForTimeout(2_000);
	expect(await runEvents()).toEqual(settled);
	await expect(submit).toHaveAccessibleName('Send prompt');
}
