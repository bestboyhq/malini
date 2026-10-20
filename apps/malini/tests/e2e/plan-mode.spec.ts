import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
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

test('a prompt in plan mode starts its own chat, and Implement hands the plan to a fresh agent chat', async () => {
	test.setTimeout(150_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-plan-ws', 'Plan workstream');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		const agentChat = currentSessionId(page);
		if (!agentChat) throw new Error('the agent chat did not commit a session id');

		await page.getByRole('button', { name: 'Run options' }).click();
		await page
			.getByRole('menu', { name: 'Run options' })
			.getByRole('menuitemcheckbox', { name: /^Plan mode/u })
			.click();
		const planMode = page.getByRole('button', { name: 'Plan mode' });
		await expect(planMode).toHaveAttribute('aria-pressed', 'true');

		await sendPrompt(page, 'IMPLEMENTABLE_PLAN Add a health endpoint');
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBe(agentChat);
		const planChat = currentSessionId(page) ?? '';
		await expect
			.poll(() => userMessages(page, planChat), { timeout: 20_000 })
			.toEqual(['IMPLEMENTABLE_PLAN Add a health endpoint']);
		expect(await userMessages(page, agentChat)).toEqual(['EDIT:a.txt']);

		const implement = page.getByTestId('implement-plan');
		await expect(implement).toBeVisible({ timeout: 20_000 });
		await captureFlow(app, 'plan-mode-plan');
		await implement.click();

		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBe(planChat);
		const implementationChat = currentSessionId(page) ?? '';
		expect(implementationChat).not.toBe(agentChat);
		await expect
			.poll(() => userMessages(page, implementationChat), { timeout: 20_000 })
			.toEqual([expect.stringContaining('Add a health endpoint')]);
		const [handoff = ''] = await userMessages(page, implementationChat);
		expect(handoff).toContain('1. Add the health route');
		await expect(planMode).toBeHidden();
		await expectAssistantReply(page);
		await captureFlow(app, 'plan-mode-implementation');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function userMessages(page: Page, sessionId: string): Promise<string[]> {
	return (await listEvents(page, sessionId)).flatMap(({ event }) =>
		event.type === 'user.message' ? [String(event['text'])] : [],
	);
}
