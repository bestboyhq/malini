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

test('a call auto mode blocks asks the user, and Always allow hands Claude the rule to keep', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-auto-mode-block-ws',
			'Auto mode block workstream',
		);
		await openWorkstream(page, workstreamId);
		const decision = page.getByRole('group', { name: 'Permission decision' });
		const runSummary = async (): Promise<unknown> => {
			const events = await listEvents(page, currentSessionId(page) ?? '');
			const completed = events.find((entry) => entry.event.type === 'run.completed');
			return completed?.event.type === 'run.completed' ? completed.event.summary : null;
		};

		await sendPrompt(page, 'AUTO_MODE_BLOCK');
		await expect(decision).toBeVisible({ timeout: 20_000 });
		await expect(page.getByText('Blocked by auto mode: Permission Grant')).toBeVisible();
		await expect(decision.getByRole('button', { name: 'Deny' })).toHaveCount(0);
		await decision.getByRole('button', { name: 'Always allow' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Always allowed' })).toContainText(
			'mcp__ops__set_member_role',
		);
		await expectAssistantReply(page);
		expect(await runSummary()).toBe('blocked:allow:always');
		await expect(page.getByText('blocked · Permission Grant')).toBeVisible();
		await expect(page.getByTestId('tool-card-failed')).toHaveCount(0);

		await startFreshChat(page);
		await sendPrompt(page, 'AUTO_MODE_BLOCK');
		await decision.getByRole('button', { name: 'Keep blocked' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Kept blocked' })).toBeVisible();
		await expectAssistantReply(page);
		expect(await runSummary()).toBe('blocked:deny:once');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a question from the agent takes the composer slot and is answered from there', async () => {
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
		const choices = page.getByRole('radiogroup', { name: 'Which?' });
		await expect(choices).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('chat-composer')).toBeHidden();
		const asked = page.getByTestId('agent-question-row');
		await expect(asked).toContainText('Asked');
		await expect(page.getByText('Ask User Question')).toHaveCount(0);

		await page.keyboard.press('2');
		await expect(choices.getByRole('radio', { name: /^B/u })).toHaveAttribute(
			'aria-checked',
			'true',
		);
		await page.getByRole('button', { name: 'Send answer' }).click();

		await expect(asked).toContainText('Answered');
		await expect(asked).toContainText('B');
		await expect(page.getByTestId('agent-question-panel')).toHaveCount(0);
		await expect(page.getByTestId('chat-composer')).toBeVisible();
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

test('questions Claude asks in parallel share one panel and one send', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-agent-question-pair-ws',
			'Agent question pair workstream',
		);
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'QUESTION_PAIR');
		const steps = page.getByRole('navigation', { name: 'Questions' });
		await expect(steps.getByRole('button')).toHaveCount(2, { timeout: 20_000 });
		await expect(page.getByTestId('agent-question-row')).toHaveCount(2);

		await page.keyboard.press('2');
		await expect(page.getByRole('radiogroup', { name: 'Where?' })).toBeVisible();
		await page.keyboard.press('1');
		await page.getByRole('button', { name: 'Send answers' }).click();

		await expect(page.getByTestId('agent-question-row').nth(0)).toContainText('B');
		await expect(page.getByTestId('agent-question-row').nth(1)).toContainText('Here');
		await expect(page.getByTestId('chat-composer')).toBeVisible();
		await expectAssistantReply(page);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
