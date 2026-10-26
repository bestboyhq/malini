import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { JOBS_RECONCILER_SETTING } from '../../src/contract/jobs';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openJobs,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';

const LEAD = 'Move apps to Logdash';
const CHILD = 'Api analytics';
const WAKE = `Wake “${LEAD}” with this report`;
const CHILD_PROMPT = `TITLE="${CHILD}" TURN_OUTCOME="The analytics endpoint answers" TURN_NEEDS="Pick the Logdash project"`;

type Decision = Readonly<{ id: string; status: string; decidedBy: string; channel: string }>;

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

function transcript(page: Page) {
	return page.getByTestId('transcript-pane');
}

function agentCalls(app: LaunchedApp, call: { tool: string; input: Record<string, unknown> }) {
	writeFileSync(join(app.home, 'malini-tool.json'), JSON.stringify(call));
}

function reconcilerPicks(app: LaunchedApp, choice: string): void {
	writeFileSync(join(app.home, 'malini-choice.txt'), choice);
}

function askedChoices(app: LaunchedApp): Array<Readonly<{ prompt: string; pick: number }>> {
	const log = join(app.home, 'malini-choices.jsonl');
	if (!existsSync(log)) return [];
	return readFileSync(log, 'utf8')
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

async function allowOnce(page: Page, heading: string): Promise<void> {
	await sendPrompt(page, 'MALINI_TOOL');
	await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 20_000 });
	await page
		.getByRole('group', { name: 'Permission decision' })
		.getByRole('button', { name: 'Allow once' })
		.last()
		.click();
	await expect(page.getByRole('status').filter({ hasText: 'Allowed once' })).not.toHaveCount(0, {
		timeout: 20_000,
	});
}

async function leadStartsChild(app: LaunchedApp): Promise<void> {
	const { page } = app;
	const api = await createSourceRepo(app.root, 'acme/api');
	await seedWorkstream(page, `file://${api}`, 'e2e-reconcile-api', 'Api work');
	await page.reload();
	const before = page.url();
	await sidebar(page).getByRole('button', { name: 'New chat', exact: true }).click();
	await expect.poll(() => page.url()).not.toBe(before);
	await expect(transcript(page)).toBeVisible({ timeout: 20_000 });
	await sendPrompt(page, `Plan it TITLE="${LEAD}"`);
	await expect(leadRow(page)).toBeVisible({ timeout: 20_000 });
	agentCalls(app, {
		tool: 'workstreams_create',
		input: { repository: 'acme/api', prompt: CHILD_PROMPT },
	});
	await allowOnce(page, 'Start a workstream in ‘acme/api’');
}

function leadRow(page: Page) {
	return sidebar(page).getByTestId('sidebar-chat').filter({ hasText: LEAD });
}

function childRow(page: Page) {
	return sidebar(page).getByTestId('sidebar-workstream').filter({ hasText: CHILD });
}

async function decisions(page: Page): Promise<Decision[]> {
	return invoke<Decision[]>(page, 'jobs.list-decisions', undefined);
}

function wokenBy(page: Page, from: string) {
	return transcript(page)
		.getByTestId('chat-prompt-from')
		.filter({ hasText: `Prompt from ${from}` });
}

test('a lead chat hears back once a workstream it started ends a turn, and Activity and the Timeline say why', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		reconcilerPicks(app, 'Wake');
		await leadStartsChild(app);

		await expect(wokenBy(page, CHILD)).toBeVisible({ timeout: 60_000 });
		await expect(
			transcript(page).getByText(/^Malini woke you: work you started moved on/u),
		).toBeVisible();
		await expect(
			transcript(page)
				.getByText(/Needs: Pick the Logdash project/u)
				.last(),
		).toBeVisible();
		const [asked] = askedChoices(app);
		expect(asked?.prompt).toContain(`Event: the chat “${CHILD}” finished a turn.`);
		expect(asked?.prompt).toContain(`Candidates:\n1. Do nothing\n2. ${WAKE}\n3. Ask you`);
		expect(asked?.pick).toBe(2);
		await captureFlow(app, 'reconciler-woken-lead');

		await openJobs(page, '#/jobs/activity');
		const row = page.getByRole('button', {
			name: `Show why Malini decided: ${WAKE}, Done`,
		});
		await expect(row).toBeVisible({ timeout: 20_000 });
		await row.click();
		await expect(
			page
				.getByRole('list', { name: 'What Malini could do' })
				.getByRole('listitem')
				.filter({ hasText: 'Picked by the model' }),
		).toContainText(WAKE);
		await captureFlow(app, 'reconciler-activity');

		await openJobs(page, '#/jobs/timeline');
		const timeline = page.getByTestId('automations-timeline');
		await expect(timeline.getByRole('listitem', { name: CHILD })).toBeVisible({ timeout: 20_000 });
		await timeline
			.getByRole('button', { name: /^Event: Turn ended: The analytics endpoint answers, / })
			.click();
		const detail = page.getByTestId('timeline-detail');
		await expect(
			detail.getByRole('list', { name: 'Caused by' }).getByRole('button', { name: /^Chat turn: / }),
		).toBeVisible();
		await expect(
			detail
				.getByRole('list', { name: 'Led to' })
				.getByRole('button', { name: `Reconciler: ${WAKE}` }),
		).toBeVisible();
		await detail
			.getByRole('list', { name: 'Led to' })
			.getByRole('button', { name: `Reconciler: ${WAKE}` })
			.click();
		await expect(
			detail.getByRole('list', { name: 'Led to' }).getByRole('button', { name: /^Chat turn: / }),
		).toBeVisible();
		await captureFlow(app, 'reconciler-timeline');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Malini asks before it acts when the model says so, and does what you pick in Activity', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		reconcilerPicks(app, 'Ask you');
		await leadStartsChild(app);

		await expect
			.poll(async () => (await decisions(page)).map((decision) => decision.status), {
				timeout: 60_000,
			})
			.toEqual(['asking']);
		await expect(page.getByTestId('sidebar-jobs-needs-you-count')).toHaveText('1');
		await openJobs(page, '#/jobs/activity');
		const ask = page.getByRole('group', {
			name: `Malini asks: “${CHILD}” needs you: Pick the Logdash project`,
		});
		await expect(ask).toBeVisible({ timeout: 20_000 });
		await captureFlow(app, 'reconciler-asks-you');
		await ask.getByRole('button', { name: WAKE }).click();

		await expect(ask).toHaveCount(0);
		await expect
			.poll(async () => (await decisions(page))[0], { timeout: 30_000 })
			.toMatchObject({ status: 'done', decidedBy: 'you' });
		await page.getByRole('button', { name: `Show why Malini decided: ${WAKE}, Done` }).click();
		await expect(
			page
				.getByRole('list', { name: 'What Malini could do' })
				.getByRole('listitem')
				.filter({ hasText: 'Picked by you' }),
		).toContainText(WAKE);
		await page.goBack();
		await leadRow(page).click();
		await expect(wokenBy(page, CHILD)).toBeVisible({ timeout: 30_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a lead answers what its workstream needs with workstreams_send, into that chat', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await leadStartsChild(app);
		await expect(childRow(page)).toBeVisible({ timeout: 60_000 });
		await expect
			.poll(async () => (await decisions(page)).map((decision) => decision.status), {
				timeout: 60_000,
			})
			.toEqual(['done']);

		agentCalls(app, {
			tool: 'workstreams_send',
			input: { workstream: CHILD, prompt: 'Report to the acme Logdash project.' },
		});
		await allowOnce(page, `Send a prompt to ‘${CHILD}’`);

		await childRow(page).click();
		await expect(
			transcript(page).getByText('Report to the acme Logdash project.', { exact: true }),
		).toBeVisible({ timeout: 30_000 });
		await expect(wokenBy(page, LEAD)).toHaveCount(2);
		await captureFlow(app, 'reconciler-lead-replies');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('with Reconcile events off, Malini leaves events no trigger handles alone', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		reconcilerPicks(app, 'Wake');
		await invoke(page, 'app.set-setting', { key: JOBS_RECONCILER_SETTING, value: 'off' });
		await leadStartsChild(app);
		await expect(childRow(page)).toBeVisible({ timeout: 60_000 });
		await childRow(page).click();
		await expectAssistantReply(page);

		await page.waitForTimeout(3_000);
		expect(askedChoices(app)).toEqual([]);
		expect(await decisions(page)).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
