import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	launchMalini,
	listEvents,
	listSessions,
	openWorkstream,
	seedWorkstream,
	selectChat,
	sendPrompt,
	startFreshChat,
} from './harness';

const MIN_AWAY_MS = 3_000;

test('a new chat runs beside the chats already working in its workstream', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-concurrent-ws', 'Concurrent');
		await openWorkstream(page, workstreamId);

		const waiting = await startChat(page, 'APPROVAL', 'waiting_for_approval', workstreamId);
		await startFreshChat(page);
		const running = await startChat(page, 'EDIT:b.txt HANG', 'running', workstreamId);
		const runningSince = Date.now();
		await startFreshChat(page);
		await sendPrompt(page, 'EDIT:c.txt');

		await expect(page.getByTestId('chat-message-bubble').first()).toContainText(
			'Hello from the fake bridge',
			{ timeout: 30_000 },
		);
		const third = currentSessionId(page);
		expect([waiting, running]).not.toContain(third);
		expect(await sessionStatuses(page, workstreamId)).toEqual(
			expect.objectContaining({ [waiting]: 'waiting_for_approval', [running]: 'running' }),
		);
		for (const sessionId of [waiting, running]) {
			const kinds = (await listEvents(page, sessionId)).map(({ event }) => event.type);
			expect(kinds).not.toContain('run.failed');
		}
		await captureFlow(app, 'concurrent-chats');

		await page.waitForTimeout(Math.max(0, MIN_AWAY_MS - (Date.now() - runningSince)));
		await selectChat(page, running);
		const awayMs = Date.now() - runningSince;
		expect(await elapsedMs(page)).toBeGreaterThanOrEqual(awayMs - 1_000);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function startChat(
	page: Page,
	prompt: string,
	status: string,
	workstreamId: string,
): Promise<string> {
	await sendPrompt(page, prompt);
	await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBeNull();
	const sessionId = currentSessionId(page) ?? '';
	await expect
		.poll(async () => (await sessionStatuses(page, workstreamId))[sessionId], { timeout: 20_000 })
		.toBe(status);
	return sessionId;
}

async function sessionStatuses(page: Page, workstreamId: string): Promise<Record<string, string>> {
	const sessions = await listSessions(page, workstreamId);
	return Object.fromEntries(sessions.map((session) => [session.id, session.status]));
}

async function elapsedMs(page: Page): Promise<number> {
	const text = (await page.getByTestId('run-status-text').textContent()) ?? '';
	const match = /^(\d+)m, ([\d.]+)s$/u.exec(text.trim());
	if (!match) throw new Error(`the run status shows no elapsed time: ${text}`);
	return Number(match[1]) * 60_000 + Number(match[2]) * 1_000;
}
