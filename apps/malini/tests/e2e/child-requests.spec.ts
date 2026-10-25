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

		const job = await invoke<{ id: string }>(page, 'jobs.save-definition', {
			name: 'Address review',
			instructions: 'APPROVAL',
			model: 'opus',
			effort: 'medium',
			runsIn: 'workstream',
		});
		await invoke(page, 'jobs.run', {
			definitionId: job.id,
			workstreamId: child.workstreamId,
			chatSessionId: chat,
		});

		const asking = page.getByRole('region', {
			name: 'Address review job in Release automation switch needs you',
		});
		const decision = asking.getByRole('group', { name: 'Permission decision' });
		await expect(decision).toBeVisible({ timeout: 30_000 });
		await expect(asking.getByRole('link', { name: 'Open transcript' })).toBeVisible();
		await expect(page.getByTestId('chat-composer')).toBeVisible();
		await captureFlow(app, 'child-request-approval-after');

		await decision.getByRole('button', { name: 'Allow once' }).click();
		await expect(asking).toHaveCount(0, { timeout: 20_000 });
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

test('a question from a workstream a chat started is answered in that chat', async () => {
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
			input: { repository: 'acme/api', prompt: 'QUESTION TITLE="Api question"' },
		});
		await sendPrompt(page, 'MALINI_TOOL');
		await page
			.getByRole('group', { name: 'Permission decision' })
			.getByRole('button', { name: 'Allow once' })
			.click();
		const chat = currentSessionId(page);

		const asking = page.getByRole('region', { name: /needs you$/u });
		const choices = asking.getByRole('radiogroup', { name: 'Which?' });
		await expect(choices).toBeVisible({ timeout: 60_000 });
		await expect(page.getByTestId('chat-composer')).toBeVisible();
		await captureFlow(app, 'child-request-question-after');

		await choices.getByRole('radio', { name: /^B/u }).click();
		await asking.getByRole('button', { name: 'Send answer' }).click();
		await expect(asking).toHaveCount(0, { timeout: 20_000 });

		const started = (
			await invoke<{ id: string; startedBy: string | null }[]>(
				page,
				'repositories.list-workstreams',
				undefined,
			)
		).find((workstream) => workstream.startedBy === workstreamId);
		if (!started) throw new Error('the chat did not start a workstream');
		const [session] = await invoke<{ id: string }[]>(page, 'chat.list-sessions', {
			workstreamId: started.id,
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
