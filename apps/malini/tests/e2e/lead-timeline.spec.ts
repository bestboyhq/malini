import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	listEvents,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
	type MaliniEvent,
} from './harness';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64',
);

type LeadCall = Readonly<{ tool: string; input: Record<string, unknown> }>;

type Workstream = Readonly<{ id: string; name: string; path: string; scope: string | null }>;

type Decision = Readonly<{ id: string; topic: string }>;

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

function timeline(page: Page) {
	return page.getByTestId('lead-timeline');
}

function leadCalls(app: LaunchedApp, calls: readonly LeadCall[], reply: string): void {
	writeFileSync(join(app.home, 'lead-calls.json'), JSON.stringify({ calls, reply }));
}

async function startLead(page: Page, title: string): Promise<Workstream> {
	const before = page.url();
	await sidebar(page).getByRole('button', { name: 'New chat', exact: true }).click();
	await expect.poll(() => page.url()).not.toBe(before);
	await sendPrompt(page, `Plan it TITLE="${title}"`);
	await expect(sidebar(page).getByTestId('sidebar-chat').filter({ hasText: title })).toBeVisible({
		timeout: 20_000,
	});
	await expect(timeline(page)).toBeVisible({ timeout: 20_000 });
	const lead = (await workstreams(page)).find((workstream) => workstream.scope === 'home');
	if (!lead) throw new Error('the lead chat has no workstream');
	return lead;
}

async function workstreams(page: Page): Promise<Workstream[]> {
	return invoke<Workstream[]>(page, 'repositories.list-workstreams', undefined);
}

async function sessionOf(page: Page, workstreamId: string): Promise<string> {
	const sessions = await invoke<{ id: string }[]>(page, 'chat.list-sessions', { workstreamId });
	const session = sessions[0];
	if (!session) throw new Error(`workstream ${workstreamId} has no chat`);
	return session.id;
}

async function prompts(page: Page, sessionId: string): Promise<Record<string, unknown>[]> {
	const events: MaliniEvent[] = await listEvents(page, sessionId);
	return events.flatMap(({ event }) => (event['type'] === 'user.message' ? [event] : []));
}

test('a chat at Home reads as a timeline, starts workstreams without asking, and hears every report they make', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		await seedWorkstream(page, `file://${api}`, 'e2e-timeline-api', 'Api work');
		await page.reload();
		const lead = await startLead(page, 'Profile build');

		leadCalls(
			app,
			[
				{ tool: 'plan_write', input: { text: '# Plan\n\nThe api serves profiles.' } },
				{
					tool: 'workstreams_create',
					input: {
						repository: 'acme/api',
						prompt: 'TITLE="Api profiles" TURN_OUTCOME="The api serves profiles"',
					},
				},
			],
			'Started the api against the plan.\n\nOutcome: The api builds against the plan',
		);
		await sendPrompt(page, 'LEAD_CALLS');
		await expect(timeline(page).getByText('Started the api against the plan.')).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('group', { name: 'Permission decision' })).toHaveCount(0);
		await expect(timeline(page).getByText('rewrote the plan every workstream reads')).toBeVisible();
		expect(readFileSync(join(lead.path, '.context', 'plan.md'), 'utf8')).toContain(
			'The api serves profiles.',
		);
		const started = timeline(page).locator('[data-timeline-entry="started"]');
		await expect(started.getByRole('link', { name: /^api/u })).toBeVisible();

		const report = timeline(page).getByTestId('timeline-report');
		await expect(report).toContainText('The api serves profiles', { timeout: 60_000 });
		const child = (await workstreams(page)).find(
			(workstream) => workstream.name === 'Api profiles',
		);
		expect(child).toBeDefined();
		const leadSession = await sessionOf(page, lead.id);
		await expect
			.poll(async () =>
				(await prompts(page, leadSession)).some(
					(prompt) =>
						Array.isArray(prompt['reports']) &&
						JSON.stringify(prompt['reports']).includes(child?.id ?? 'missing'),
				),
			)
			.toBe(true);
		await captureFlow(app, 'lead-timeline-reports');

		await sendPrompt(page, 'WHICH_BRIEF');
		await expect(timeline(page).getByText('Fresh: yes')).toBeVisible({ timeout: 30_000 });
		await expect(
			timeline(page).getByText(
				'“Api profiles” finished a turn. Outcome: The api serves profiles.',
				{
					exact: false,
				},
			),
		).toBeVisible();
		await expect(timeline(page).getByText('The user: Plan it TITLE="Profile build"')).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a lead asks you one decision at a time, you answer on its card or in a message, and it hears your pick', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		await seedWorkstream(page, `file://${api}`, 'e2e-decisions-api', 'Api work');
		await page.reload();
		const lead = await startLead(page, 'Profile decisions');
		const child = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-decisions-child',
			'Api child',
			lead.id,
		);
		mkdirSync(join(child.worktree, '.context'), { recursive: true });
		const picture = join(child.worktree, '.context', 'drop-hours.png');
		writeFileSync(picture, PNG);

		leadCalls(
			app,
			[
				{
					tool: 'decisions_ask',
					input: {
						topic: 'Agent hours',
						question: 'Keep agent hours on your cards?',
						why: 'Next to agents at once they show how long you work.',
						options: [
							{ label: 'Drop agent hours', note: 'Cards lead with runs', picture },
							{ label: 'Keep both', note: 'Cards lead with hours' },
						],
						recommended: 1,
						meanwhile: 'Building without agent hours meanwhile',
					},
				},
				{
					tool: 'decisions_ask',
					input: {
						topic: 'Handle',
						question: 'Where does your handle come from?',
						options: [{ label: 'You pick it' }, { label: 'Your GitHub login' }],
						recommended: 1,
					},
				},
			],
			'Two decisions wait for you.\n\nOutcome: Asked two decisions',
		);
		await sendPrompt(page, 'LEAD_CALLS');

		const card = page.getByTestId('lead-decision-queue');
		await expect(card).toHaveAccessibleName('Decision: Agent hours', { timeout: 30_000 });
		await expect(card.getByTestId('lead-decision-position')).toHaveText('1 of 2');
		await expect(card.getByRole('button', { name: 'Choose Drop agent hours' })).toBeVisible();
		await expect(card).toContainText('Building without agent hours meanwhile');
		await expect(page.locator('[data-testid="chat-composer-input"]')).toBeVisible();
		const decisions = page.getByTestId('lead-decisions');
		await expect(
			decisions.getByRole('button', { name: 'Agent hours, waiting for you' }),
		).toBeVisible();
		await expect(decisions.getByRole('button', { name: 'Handle, waiting for you' })).toBeVisible();
		await captureFlow(app, 'lead-timeline-decision');

		await card.getByRole('button', { name: 'Later' }).click();
		await expect(card).toHaveCount(0);
		const waiting = page.getByTestId('lead-decisions-waiting');
		await expect(waiting).toContainText('2 decisions wait for you');
		await waiting.getByRole('button').click();
		await expect(card).toHaveAccessibleName('Decision: Agent hours');
		await card.getByRole('button', { name: 'Next decision' }).click();
		await expect(card).toHaveAccessibleName('Decision: Handle');
		await card.getByRole('button', { name: 'Previous decision' }).click();

		await card.getByRole('button', { name: 'See Drop agent hours full size' }).click();
		const viewer = page.getByRole('dialog', { name: 'Agent hours, full size' });
		await expect(viewer).toBeVisible();
		await viewer
			.getByRole('textbox', { name: 'Why this option' })
			.fill('Hours show how long I work');
		await viewer.getByRole('button', { name: 'Go with Drop agent hours' }).click();
		await expect(viewer).toHaveCount(0);
		const decided = timeline(page).locator('[data-timeline-entry="decided"]');
		await expect(decided).toContainText('You decided');
		await expect(decided).toContainText('Agent hours: Drop agent hours');
		await expect(decided).toContainText('Hours show how long I work');
		await expect(card).toHaveAccessibleName('Decision: Handle');
		await expect(card.getByTestId('lead-decision-position')).toHaveCount(0);

		const leadSession = await sessionOf(page, lead.id);
		await expect
			.poll(
				async () =>
					(await prompts(page, leadSession)).find(
						(prompt) => Array.isArray(prompt['decisions']) && prompt['decisions'].length > 0,
					)?.['text'],
			)
			.toBe('Decided “Agent hours”: Drop agent hours.\nWhy: Hours show how long I work');

		await decided.getByRole('button', { name: 'Change Agent hours' }).click();
		await expect(card).toHaveAccessibleName('Decision: Agent hours');
		await expect(card.getByRole('button', { name: 'Choose Drop agent hours' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await card.getByRole('button', { name: 'Choose Keep both' }).click();
		await expect(decided).toContainText('Agent hours: Keep both', { timeout: 20_000 });
		await expect
			.poll(async () =>
				(await prompts(page, leadSession)).some(
					(prompt) =>
						prompt['text'] === 'Changed “Agent hours” to Keep both, from Drop agent hours.',
				),
			)
			.toBe(true);

		const handle = (
			await invoke<Decision[]>(page, 'chat.list-lead-decisions', { sessionId: leadSession })
		).find((entry) => entry.topic === 'Handle');
		leadCalls(
			app,
			[
				{
					tool: 'decisions_answer',
					input: { decision: handle?.id, option: 2, reason: 'Use my GitHub login' },
				},
			],
			'Recorded your handle.\n\nOutcome: Your handle is your GitHub login',
		);
		await sendPrompt(page, 'Use my GitHub login for the handle LEAD_CALLS');
		await expect(card).toHaveCount(0, { timeout: 30_000 });
		await expect(decisions).toContainText('all answered');
		await expect(timeline(page).locator('[data-timeline-entry="decided"]')).toHaveCount(2);
		await captureFlow(app, 'lead-timeline-decided');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a prompt for a workstream that is on a turn waits for that turn, then arrives without asking', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		await seedWorkstream(page, `file://${api}`, 'e2e-deliveries-api', 'Api work');
		await page.reload();
		const lead = await startLead(page, 'Profile relay');
		const child = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-deliveries-child',
			'Api child',
			lead.id,
		);
		const childSession = await invoke<string>(page, 'chat.start-session', {
			workstreamId: child.workstreamId,
		});
		await invoke(page, 'chat.send-prompt', { sessionId: childSession, prompt: 'HANG' });

		leadCalls(
			app,
			[
				{
					tool: 'workstreams_send',
					input: { workstream: child.workstreamId, prompt: 'Use the plan for the profile route' },
				},
			],
			'Sent the api the plan.\n\nOutcome: The api has the plan once its turn ends',
		);
		await sendPrompt(page, 'LEAD_CALLS');
		const sent = timeline(page).locator('[data-timeline-entry="sent"]');
		await expect(sent).toContainText('waits for its turn to end', { timeout: 30_000 });
		await expect(page.getByRole('group', { name: 'Permission decision' })).toHaveCount(0);
		await captureFlow(app, 'lead-timeline-send-waits');

		await invoke(page, 'chat.cancel-run', { sessionId: childSession });
		await expect(sent).toContainText('delivered', { timeout: 30_000 });
		await expect
			.poll(async () =>
				(await prompts(page, childSession)).some(
					(prompt) =>
						prompt['text'] === 'Use the plan for the profile route' && prompt['from'] === lead.id,
				),
			)
			.toBe(true);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('allowing what a workstream it started asks stops the lead chat from waiting on you while that workstream works on', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		await seedWorkstream(page, `file://${api}`, 'e2e-held-api', 'Api work');
		await page.reload();
		const lead = await startLead(page, 'Profile reads');
		const child = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-held-child',
			'Api reads',
			lead.id,
		);
		const childSession = await invoke<string>(page, 'chat.start-session', {
			workstreamId: child.workstreamId,
		});
		await invoke(page, 'chat.send-prompt', { sessionId: childSession, prompt: 'APPROVAL_HOLD' });

		const status = sidebar(page)
			.getByTestId('sidebar-chat')
			.filter({ hasText: 'Profile reads' })
			.getByTestId('sidebar-chat-status');
		const decision = page.getByRole('group', { name: 'Permission decision' });
		await expect(decision).toBeVisible({ timeout: 30_000 });
		await expect(status).toHaveAccessibleName(/A workstream it started is waiting for approval/u);

		await decision.getByRole('button', { name: 'Allow once' }).click();
		await expect(decision).toHaveCount(0);
		await expect(status).not.toHaveAccessibleName(/waiting for approval/u);
		const ended = (await listEvents(page, childSession)).some(
			({ event }) => event['type'] === 'run.completed',
		);
		expect(ended).toBe(false);

		writeFileSync(join(app.home, 'release-approval'), '');
		await expect
			.poll(async () =>
				(await listEvents(page, childSession)).some(
					({ event }) => event['type'] === 'run.completed',
				),
			)
			.toBe(true);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a lead relays a picture a workstream it started took, and its alt keeps the quotes in it', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		await seedWorkstream(page, `file://${api}`, 'e2e-relay-api', 'Api work');
		await page.reload();
		const lead = await startLead(page, 'Profile pictures');
		const child = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-relay-child',
			'Api hero',
			lead.id,
		);
		mkdirSync(join(child.worktree, '.context'), { recursive: true });
		const picture = join(child.worktree, '.context', 'hero-a.png');
		writeFileSync(picture, PNG);

		leadCalls(
			app,
			[{ tool: 'plan_write', input: { text: '# Plan\n\nThe hero reads A.' } }],
			`The hero now reads A.\n\n![Hero "A" in dark mode](${picture})\n\nOutcome: The hero reads A`,
		);
		await sendPrompt(page, 'LEAD_CALLS');

		const relayed = timeline(page).getByRole('img', { name: 'Hero "A" in dark mode' });
		await expect(relayed).toBeVisible({ timeout: 30_000 });
		await expect
			.poll(() =>
				relayed.evaluate((image) => Number('naturalWidth' in image ? image.naturalWidth : 0) > 0),
			)
			.toBe(true);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
