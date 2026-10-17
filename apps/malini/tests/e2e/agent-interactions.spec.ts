import { expect, test, type Page } from '@playwright/test';
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
	startFreshChat,
} from './harness';

async function decisionTheAgentGot(page: Page): Promise<unknown> {
	const events = await listEvents(page, currentSessionId(page) ?? '');
	const completed = events.find(
		(entry) => entry.event.type === 'tool.completed' && entry.event.name === 'read_file',
	);
	return completed?.event.type === 'tool.completed' ? completed.event.output : null;
}

test('a permission request waits for the user, hands the agent their decision, and is not asked again once allowed for the workstream', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-agent-interactions-ws',
			'Agent interactions workstream',
		);
		await openWorkstream(page, workstreamId);
		const decision = page.getByRole('group', { name: 'Permission decision' });

		await sendPrompt(page, 'APPROVAL');
		await expect(decision).toBeVisible({ timeout: 20_000 });
		await decision.getByRole('button', { name: 'Allow once' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Allowed once' })).toBeVisible();
		await expectAssistantReply(page);
		expect(await decisionTheAgentGot(page)).toEqual({ decision: 'allow', scope: 'once' });

		await startFreshChat(page);
		await sendPrompt(page, 'APPROVAL');
		await decision.getByRole('button', { name: 'Deny' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Denied' })).toBeVisible();
		await expectAssistantReply(page);
		expect(await decisionTheAgentGot(page)).toEqual({ decision: 'deny', scope: 'once' });

		await startFreshChat(page);
		await sendPrompt(page, 'APPROVAL');
		await decision.getByRole('button', { name: 'Always allow' }).click();
		await page
			.getByRole('menu', { name: 'Always allow' })
			.getByRole('menuitem', { name: 'Allow for this workstream' })
			.click();
		await expect(
			page.getByRole('status').filter({ hasText: 'Allowed for this workstream' }),
		).toBeVisible();
		await expectAssistantReply(page);
		expect(await decisionTheAgentGot(page)).toEqual({ decision: 'allow', scope: 'workstream' });

		await startFreshChat(page);
		await sendPrompt(page, 'APPROVAL');
		await expectAssistantReply(page);
		await expect(decision).toHaveCount(0);
		expect(await decisionTheAgentGot(page)).toMatchObject({ decision: 'allow' });

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a question from the agent is answered from its card', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-agent-question-ws',
			'Agent question workstream',
		);
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'QUESTION');
		const question = page.getByRole('region', { name: 'Claude has a question' });
		await expect(question.getByRole('group', { name: 'Which?' })).toBeVisible({
			timeout: 20_000,
		});
		await question.getByRole('radio', { name: /^B/u }).check();
		await question.getByRole('button', { name: 'Send answer' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Answered' })).toBeVisible();
		await expectAssistantReply(page);

		const events = await listEvents(page, currentSessionId(page) ?? '');
		const completed = events.find((entry) => entry.event.type === 'run.completed');
		expect(completed?.event.type === 'run.completed' ? completed.event.summary : null).toContain(
			'"B"',
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
