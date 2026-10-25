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
	type LaunchedApp,
} from './harness';

type RunRow = Readonly<{ title: string; status: string; sessionId: string | null }>;

function agentCalls(app: LaunchedApp, call: { tool: string; input: Record<string, unknown> }) {
	writeFileSync(join(app.home, 'malini-tool.json'), JSON.stringify(call));
}

async function saveApprovalJob(page: Page): Promise<string> {
	const job = await invoke<{ id: string }>(page, 'jobs.save-definition', {
		name: 'Address review',
		instructions: 'APPROVAL',
		model: 'opus',
		effort: 'medium',
		runsIn: 'workstream',
	});
	return job.id;
}

async function finishedRun(page: Page, title: string): Promise<RunRow> {
	let finished: RunRow | undefined;
	await expect
		.poll(
			async () => {
				const runs = await invoke<RunRow[]>(page, 'jobs.list-runs', undefined);
				finished = runs.find((run) => run.title === title);
				return finished?.status;
			},
			{ timeout: 30_000 },
		)
		.toBe('succeeded');
	if (!finished?.sessionId) throw new Error(`${title} ran without a transcript`);
	return finished;
}

test('a job a chat runs in another workstream asks for permission in that chat, and the chat answers it', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-child-lead', 'Release lead');
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

		await invoke(page, 'jobs.run', {
			definitionId: await saveApprovalJob(page),
			workstreamId: child.workstreamId,
			chatSessionId: chat,
		});

		const asking = page.getByRole('region', {
			name: 'Address review job in Release automation switch needs you',
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

test('what the workstreams a chat started, and theirs, ask is answered in that chat', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		const { workstreamId } = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-child-question-lead',
			'Api lead',
		);
		await openWorkstream(page, workstreamId);
		agentCalls(app, {
			tool: 'workstreams_create',
			input: { repository: 'acme/api', prompt: 'MALINI_TOOL TITLE="Api child"' },
		});
		await sendPrompt(page, 'MALINI_TOOL');
		const ownDecision = page
			.getByTestId('transcript-pane')
			.getByRole('group', { name: 'Permission decision' });
		await expect(ownDecision).toBeVisible({ timeout: 20_000 });
		agentCalls(app, {
			tool: 'workstreams_create',
			input: { repository: 'acme/api', prompt: 'QUESTION TITLE="Api grandchild"' },
		});
		await ownDecision.getByRole('button', { name: 'Allow once' }).click();
		const chat = currentSessionId(page);

		const asking = page.getByRole('region', { name: /needs you$/u });
		const childDecision = asking.getByRole('group', { name: 'Permission decision' });
		await expect(childDecision).toBeVisible({ timeout: 60_000 });
		await expect(
			asking.getByRole('heading', { name: 'Start a workstream in ‘acme/api’' }),
		).toBeVisible();
		await captureFlow(app, 'child-request-queue-chat-approval');
		await childDecision.getByRole('button', { name: 'Allow once' }).click();

		const choices = asking.getByRole('radiogroup', { name: 'Which?' });
		await expect(choices).toBeVisible({ timeout: 60_000 });
		await expect(page.getByTestId('chat-composer')).toBeHidden();
		await captureFlow(app, 'child-request-queue-grandchild-question');

		await choices.getByRole('radio', { name: /^B/u }).click();
		await asking.getByRole('button', { name: 'Send answer' }).click();
		await expect(asking).toHaveCount(0, { timeout: 20_000 });

		const workstreams = await invoke<{ id: string; startedBy: string | null }[]>(
			page,
			'repositories.list-workstreams',
			undefined,
		);
		const child = workstreams.find((workstream) => workstream.startedBy === workstreamId);
		const grandchild = workstreams.find((workstream) => workstream.startedBy === child?.id);
		if (!grandchild) throw new Error('the started workstream did not start one of its own');
		const [session] = await invoke<{ id: string }[]>(page, 'chat.list-sessions', {
			workstreamId: grandchild.id,
		});
		await expect
			.poll(
				async () => {
					const events = await listEvents(page, session?.id ?? '');
					const completed = events.find((entry) => entry.event.type === 'run.completed');
					return completed?.event.type === 'run.completed' ? completed.event.summary : null;
				},
				{ timeout: 30_000 },
			)
			.toContain('"B"');
		expect(currentSessionId(page)).toBe(chat);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('requests from several children queue in the composer slot one at a time, over a draft, and Later folds them until a new one comes', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-queue-lead', 'Release lead');
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

		const definitionId = await saveApprovalJob(page);
		const runIn = (child: { workstreamId: string }) =>
			invoke(page, 'jobs.run', {
				definitionId,
				workstreamId: child.workstreamId,
				chatSessionId: chat,
			});
		const [switchChild, notesChild, siteChild] = children;
		if (!switchChild || !notesChild || !siteChild) throw new Error('the children were not seeded');
		await runIn(switchChild);
		await runIn(notesChild);

		const queue = page.getByTestId('child-request-queue');
		const position = queue.getByTestId('child-request-position');
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
					(await invoke<RunRow[]>(page, 'jobs.list-runs', undefined))
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
