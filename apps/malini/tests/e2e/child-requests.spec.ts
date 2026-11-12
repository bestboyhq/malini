import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

type RunRow = Readonly<{ title: string; status: string; sessionId: string | null }>;

async function saveApprovalAutomation(page: Page): Promise<string> {
	const automation = await invoke<{ id: string }>(page, 'automations.save-definition', {
		name: 'Address review',
		instructions: 'APPROVAL',
		model: 'opus',
		effort: 'medium',
		runsIn: 'workstream',
	});
	return automation.id;
}

async function finishedRun(page: Page, title: string): Promise<RunRow> {
	let finished: RunRow | undefined;
	await expect
		.poll(
			async () => {
				const runs = await invoke<RunRow[]>(page, 'automations.list-runs', undefined);
				finished = runs.find((run) => run.title === title);
				return finished?.status;
			},
			{ timeout: 30_000 },
		)
		.toBe('succeeded');
	if (!finished?.sessionId) throw new Error(`${title} ran without a transcript`);
	return finished;
}

test('an automation a chat runs in another workstream asks for permission in that chat, and the chat answers it', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-child-starter',
			'Release chat',
		);
		const child = await seedWorkstream(
			page,
			source,
			'e2e-child-switch',
			'Release automation switch',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Plan the release');
		await expectAssistantReply(page);
		const chat = currentSessionId(page);
		if (!chat) throw new Error('the chat did not commit a session id');

		await invoke(page, 'automations.run', {
			definitionId: await saveApprovalAutomation(page),
			workstreamId: child.workstreamId,
			chatSessionId: chat,
		});

		const asking = page.getByRole('region', {
			name: 'Address review automation in Release automation switch needs you',
		});
		const decision = asking.getByRole('group', { name: 'Permission decision' });
		await expect(decision).toBeVisible({ timeout: 30_000 });
		await expect(asking.getByRole('link', { name: 'Open transcript' })).toBeVisible();
		await expect(page.getByTestId('chat-composer')).toBeHidden();
		await captureFlow(app, 'child-request-queue-approval');

		await decision.getByRole('button', { name: 'Allow once' }).click();
		await expect(asking).toHaveCount(0, { timeout: 20_000 });
		await expect(page.getByTestId('chat-composer')).toBeVisible();
		const run = await finishedRun(page, 'Address review');
		const events = await listEvents(page, run.sessionId ?? '');
		const read = events.find(
			(entry) => entry.event.type === 'tool.completed' && entry.event.name === 'read_file',
		);
		expect(read?.event.type === 'tool.completed' ? read.event.output : null).toEqual({
			decision: 'allow',
			scope: 'once',
		});
		expect(currentSessionId(page)).toBe(chat);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('what a workstream a chat started asks waits in its own chat, and the chat that started it stays free', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		const { workstreamId } = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-child-question-starter',
			'Api chat',
		);
		await openWorkstream(page, workstreamId);
		writeFileSync(
			join(app.home, 'tool-calls.json'),
			JSON.stringify({
				calls: [
					{
						tool: 'workstreams_create',
						input: { repository: 'acme/api', prompt: 'QUESTION TITLE="Api child"' },
					},
				],
				reply: 'Started the api child',
			}),
		);
		await sendPrompt(page, 'TOOL_CALLS');
		await expect(page.getByText('Started the api child', { exact: true })).toBeVisible({
			timeout: 30_000,
		});

		const childRow = page
			.getByRole('navigation', { name: 'Connected repositories' })
			.getByTestId('sidebar-workstream')
			.filter({ hasText: 'Api child' });
		await expect(childRow.getByRole('status')).toHaveAccessibleName(/waiting for approval/u, {
			timeout: 60_000,
		});
		await expect(page.getByRole('region', { name: /needs you$/u })).toHaveCount(0);
		await expect(page.getByTestId('request-queue')).toHaveCount(0);
		await expect(page.getByTestId('chat-composer')).toBeVisible();
		await captureFlow(app, 'started-workstream-asks-in-its-own-chat');

		await childRow.click();
		const choices = page.getByRole('radiogroup', { name: 'Which?' });
		await expect(choices).toBeVisible({ timeout: 30_000 });
		await choices.getByRole('radio', { name: /^B/u }).click();
		await page.getByRole('button', { name: 'Send answer' }).click();
		await expect(choices).toHaveCount(0, { timeout: 20_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('requests from several automations a chat ran queue in the composer slot one at a time, over a draft, and Later folds them until a new one comes', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-queue-starter',
			'Release chat',
		);
		const children = [
			await seedWorkstream(page, source, 'e2e-queue-switch', 'Release automation switch'),
			await seedWorkstream(page, source, 'e2e-queue-notes', 'Release notes'),
			await seedWorkstream(page, source, 'e2e-queue-site', 'Release site'),
		];
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Plan the release');
		await expectAssistantReply(page);
		const chat = currentSessionId(page);
		if (!chat) throw new Error('the chat did not commit a session id');
		const input = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await input.click();
		await page.keyboard.type('half a thought', { delay: 5 });

		const definitionId = await saveApprovalAutomation(page);
		const runIn = (child: { workstreamId: string }) =>
			invoke(page, 'automations.run', {
				definitionId,
				workstreamId: child.workstreamId,
				chatSessionId: chat,
			});
		const [switchChild, notesChild, siteChild] = children;
		if (!switchChild || !notesChild || !siteChild) throw new Error('the children were not seeded');
		await runIn(switchChild);
		await runIn(notesChild);

		const queue = page.getByTestId('request-queue');
		const position = queue.getByTestId('request-position');
		const composer = page.getByTestId('chat-composer');
		await expect(position).toHaveText('1 of 2', { timeout: 30_000 });
		await expect(composer).toBeHidden();
		const first = await queue.getAttribute('aria-label');
		await queue.getByRole('button', { name: 'Next request' }).click();
		await expect(position).toHaveText('2 of 2');
		await expect(queue).not.toHaveAttribute('aria-label', first ?? '');
		await captureFlow(app, 'child-request-queue-over-draft');

		await queue.getByRole('button', { name: 'Allow once' }).click();
		await expect(queue).toHaveAttribute('aria-label', first ?? '');
		await expect(position).toHaveCount(0);
		await page.keyboard.press('Escape');
		const waiting = page.getByRole('button', { name: 'Answer: 1 request needs you' });
		await expect(waiting).toBeVisible();
		await expect(composer).toBeVisible();
		await expect(input).toHaveText('half a thought');

		await runIn(siteChild);
		await expect(position).toHaveText('1 of 2', { timeout: 30_000 });
		await expect(waiting).toHaveCount(0);
		await queue.getByRole('button', { name: 'Allow once' }).click();
		await expect(position).toHaveCount(0);
		await queue.getByRole('button', { name: 'Allow once' }).click();
		await expect(queue).toHaveCount(0, { timeout: 20_000 });
		await expect(input).toHaveText('half a thought');
		await expect
			.poll(
				async () =>
					(await invoke<RunRow[]>(page, 'automations.list-runs', undefined))
						.filter((run) => run.title === 'Address review')
						.map((run) => run.status),
				{ timeout: 30_000 },
			)
			.toEqual(['succeeded', 'succeeded', 'succeeded']);
		expect(currentSessionId(page)).toBe(chat);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
