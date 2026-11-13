import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	listEvents,
	openWorkstream,
	promptsOf,
	reportsHeardBy,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';
import { seedWorkstreamOnFakeGithub, sidebarStatus } from './fake-github';

type ToolCall = Readonly<{ tool: string; input: Record<string, unknown> }>;

type WorkstreamRow = Readonly<{ id: string; startedBy: string | null }>;

const NEEDS_YOU = /waiting for approval|needs your input|needs attention/u;

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

function transcript(page: Page) {
	return page.getByTestId('transcript-pane');
}

function row(page: Page, workstreamId: string) {
	return sidebar(page).locator(
		`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`,
	);
}

function rowNamed(page: Page, name: string) {
	return sidebar(page).getByTestId('sidebar-workstream').filter({ hasText: name });
}

function rowsIn(page: Page, repository: string) {
	return sidebar(page).locator(
		`[data-testid="sidebar-workstream"][data-repository-full-name="${repository}"]`,
	);
}

async function untilIdle(page: Page): Promise<void> {
	await expect(page.getByTestId('chat-composer-submit')).not.toHaveAccessibleName(
		'Stop current run',
		{ timeout: 30_000 },
	);
}

async function callTools(
	app: LaunchedApp,
	calls: readonly ToolCall[],
	reply: string,
): Promise<void> {
	const { page } = app;
	writeFileSync(join(app.home, 'tool-calls.json'), JSON.stringify({ calls, reply }));
	await untilIdle(page);
	await sendPrompt(page, 'TOOL_CALLS');
	await expect(transcript(page).getByText(reply, { exact: true })).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByRole('group', { name: 'Permission decision' })).toHaveCount(0);
}

async function lastReply(page: Page, text: string): Promise<void> {
	await expect(transcript(page).getByText(text, { exact: true }).last()).toBeVisible({
		timeout: 30_000,
	});
}

async function choose(page: Page, setting: string, choice: string): Promise<void> {
	const panel = page.getByRole('group', { name: 'Sidebar options' });
	await panel.getByRole('button', { name: new RegExp(`^${setting}: `, 'u') }).click();
	await page
		.getByRole('menu', { name: setting, exact: true })
		.getByRole('menuitemradio', { name: choice })
		.click();
	await expect(panel.getByRole('button', { name: `${setting}: ${choice}` })).toBeVisible();
}

test('a chat starts workstreams in two repositories, which run on their own and show no link to it', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		const web = await createSourceRepo(app.root, 'acme/web');
		const starter = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-starter-api',
			'Logdash migration',
		);
		await invoke(page, 'repositories.create-repository', { repoUrl: `file://${web}` });
		await openWorkstream(page, starter.workstreamId);
		const starterRow = row(page, starter.workstreamId);
		await expect(starterRow).toHaveAttribute('aria-current', 'page');

		await callTools(
			app,
			[
				{
					tool: 'workstreams_create',
					input: { repository: 'acme/api', prompt: 'WHICH_LINEAGE TITLE="Api analytics"' },
				},
				{
					tool: 'workstreams_create',
					input: { repository: 'acme/web', prompt: 'WHICH_LINEAGE TITLE="Web analytics"' },
				},
			],
			'Started 2 without asking',
		);

		await expect(sidebar(page).getByTestId('sidebar-workstream')).toHaveCount(3, {
			timeout: 30_000,
		});
		await expect(rowsIn(page, 'acme/web')).toHaveCount(1);
		await expect(rowsIn(page, 'acme/api')).toHaveCount(2);
		const card = transcript(page).getByTestId('started-workstreams');
		await expect(card.getByRole('link', { name: /^acme\/api, / })).toBeVisible();
		await expect(card.getByRole('link', { name: /^acme\/web, / })).toBeVisible();
		await starterRow.hover();
		await expect(page.getByRole('list', { name: /^Started by / })).toHaveCount(0);
		await page.mouse.move(0, 0);
		await expect(page.getByRole('heading', { name: /^Started here/u })).toHaveCount(0);
		await captureFlow(app, 'started-workstreams-sidebar');

		await card.getByRole('link', { name: /^acme\/web, / }).click();
		const startedWeb = rowsIn(page, 'acme/web');
		await expect(startedWeb).toHaveAttribute('aria-current', 'page');
		await lastReply(page, 'Started by: Logdash migration');
		await lastReply(page, 'Siblings: acme/api');
		await expect(transcript(page).getByTestId('chat-prompt-from')).toHaveText(
			'Prompt from Logdash migration',
		);
		await expect(page.getByTestId('workstream-lineage')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Disconnect from Logdash migration' }),
		).toHaveCount(0);
		await captureFlow(app, 'started-workstream-on-its-own');

		const workstreams = await invoke<readonly WorkstreamRow[]>(
			page,
			'repositories.list-workstreams',
		);
		expect(
			workstreams
				.filter((workstream) => workstream.id !== starter.workstreamId)
				.map((workstream) => workstream.startedBy),
		).toEqual([starter.workstreamId, starter.workstreamId]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a workstream a chat started needs you in its own row, and its turn reaches that chat only when the chat asks to wake', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		const starter = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-quiet-starter',
			'Ship analytics',
		);
		await openWorkstream(page, starter.workstreamId);
		await callTools(
			app,
			[
				{
					tool: 'workstreams_create',
					input: {
						repository: 'acme/api',
						prompt:
							'TITLE="Api analytics" TURN_OUTCOME="The endpoint answers" TURN_NEEDS="Pick the Logdash project"',
					},
				},
			],
			'Started the api work without asking',
		);

		const child = rowNamed(page, 'Api analytics');
		await expect(child.getByRole('status')).toHaveAccessibleName(NEEDS_YOU, { timeout: 60_000 });
		await page.waitForTimeout(2_000);
		expect(await reportsHeardBy(page, starter.workstreamId)).toEqual([]);
		const [starterSession] = await invoke<{ id: string }[]>(page, 'chat.list-sessions', {
			workstreamId: starter.workstreamId,
		});
		expect(await promptsOf(page, starterSession?.id ?? '')).toHaveLength(1);
		await expect(sidebarStatus(page, starter.workstreamId)).not.toHaveAccessibleName(NEEDS_YOU);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'started-workstreams-quiet');

		const childId = await child.getAttribute('data-workstream-id');
		await callTools(
			app,
			[
				{
					tool: 'workstreams_send',
					input: {
						workstream: childId,
						prompt:
							'TURN_OUTCOME="The endpoint reads the project" TURN_NEEDS="Pick the Logdash key"',
						wake: true,
					},
				},
			],
			'Asked the api work to wake me',
		);
		await expect
			.poll(
				async () =>
					(await reportsHeardBy(page, starter.workstreamId)).map((report) => [
						report['outcome'],
						report['needs'],
					]),
				{ timeout: 60_000 },
			)
			.toEqual([['The endpoint reads the project', 'Pick the Logdash key']]);
		await untilIdle(page);
		await expect(sidebarStatus(page, starter.workstreamId)).not.toHaveAccessibleName(NEEDS_YOU);

		await page
			.getByRole('group', { name: 'Focus' })
			.getByRole('button', { name: 'Sidebar options' })
			.click();
		await page
			.getByRole('group', { name: 'Sidebar options' })
			.getByRole('button', { name: /^Advanced/u })
			.click();
		await choose(page, 'Grouping', 'Status');
		await page.keyboard.press('Escape');
		const idle = sidebar(page)
			.getByTestId('sidebar-section')
			.filter({ has: page.getByRole('button', { name: /^Idle, /u }) });
		await expect(
			idle.getByTestId('sidebar-workstream').filter({ hasText: 'Ship analytics' }),
		).toBeVisible();
		await page.mouse.move(0, 0);
		await captureFlow(app, 'started-workstreams-quiet-status');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a chat that asks to wake hears a turn that ends over a background command, and again when it goes on, which delivers what waited and commits', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const notes = await createSourceRepo(app.root, 'notes');
		const starter = await seedWorkstream(page, notes, 'e2e-goes-on-starter', 'Suite starter');
		const childId = 'e2e-goes-on-child';
		const { worktree } = await seedWorkstreamOnFakeGithub(
			app,
			childId,
			null,
			async () => {},
			starter.workstreamId,
		);
		const childSession = await invoke<string>(page, 'chat.start-session', {
			workstreamId: childId,
		});
		await openWorkstream(page, starter.workstreamId);

		await callTools(
			app,
			[
				{
					tool: 'workstreams_send',
					input: { workstream: childId, prompt: 'BACKGROUND_GOES_ON', wake: true },
				},
			],
			'Sent it the suite',
		);
		await expect
			.poll(
				async () =>
					(await reportsHeardBy(page, starter.workstreamId)).map(
						(report) => report['backgroundCommands'] ?? null,
					),
				{ timeout: 30_000 },
			)
			.toEqual([['Run the e2e suite']]);

		writeFileSync(join(app.home, 'end-background-command'), '');
		await expect
			.poll(() => invoke(page, 'chat.workstream-has-working-run', { workstreamId: childId }))
			.toBe(true);
		await callTools(
			app,
			[
				{
					tool: 'workstreams_send',
					input: {
						workstream: childId,
						prompt: 'TURN_OUTCOME="Noted the follow-up"',
						wake: true,
					},
				},
			],
			'Sent the follow-up',
		);
		expect(await promptsOf(page, childSession)).toHaveLength(1);
		await captureFlow(app, 'started-workstreams-background-wait');

		writeFileSync(join(app.home, 'end-background-turn'), '');
		await expect
			.poll(async () => (await promptsOf(page, childSession)).length, { timeout: 30_000 })
			.toBe(2);
		await expect
			.poll(
				async () =>
					(await reportsHeardBy(page, starter.workstreamId)).map((report) => [
						report['outcome'],
						report['backgroundCommands'] ?? null,
					]),
				{ timeout: 30_000 },
			)
			.toEqual([
				[null, ['Run the e2e suite']],
				['The e2e suite passes', null],
				['Noted the follow-up', null],
			]);
		await expect
			.poll(
				() =>
					execFileSync('git', ['-C', worktree, 'log', '--format=%s'], { encoding: 'utf8' })
						.trim()
						.split('\n')[0],
				{ timeout: 30_000 },
			)
			.toBe('test: fix the flaky test');
		await captureFlow(app, 'started-workstreams-background-went-on');
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
		const starter = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-deliveries-starter',
			'Profile relay',
		);
		const child = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-deliveries-child',
			'Api child',
			starter.workstreamId,
		);
		const childSession = await invoke<string>(page, 'chat.start-session', {
			workstreamId: child.workstreamId,
		});
		await invoke(page, 'chat.send-prompt', { sessionId: childSession, prompt: 'HANG' });
		await openWorkstream(page, starter.workstreamId);

		const plan = 'Use the plan for the profile route';
		const arrived = async () =>
			(await promptsOf(page, childSession)).some(
				(prompt) => prompt['text'] === plan && prompt['from'] === starter.workstreamId,
			);
		await callTools(
			app,
			[{ tool: 'workstreams_send', input: { workstream: child.workstreamId, prompt: plan } }],
			'Sent the api the plan',
		);
		expect(await arrived()).toBe(false);
		await captureFlow(app, 'started-workstreams-send-waits');

		await invoke(page, 'chat.cancel-run', { sessionId: childSession });
		await expect.poll(arrived, { timeout: 30_000 }).toBe(true);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a workstream a chat started asks for approval in its own row, and that chat shows nothing', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		const starter = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-held-starter',
			'Profile reads',
		);
		const child = await seedWorkstream(
			page,
			`file://${api}`,
			'e2e-held-child',
			'Api reads',
			starter.workstreamId,
		);
		await openWorkstream(page, starter.workstreamId);
		const childStatus = sidebarStatus(page, child.workstreamId);
		const starterStatus = sidebarStatus(page, starter.workstreamId);
		await expect(childStatus).toBeVisible();
		await page.waitForTimeout(1_000);
		const childSession = await invoke<string>(page, 'chat.start-session', {
			workstreamId: child.workstreamId,
		});
		await invoke(page, 'chat.send-prompt', { sessionId: childSession, prompt: 'APPROVAL_HOLD' });

		await expect(childStatus).toHaveAccessibleName(
			'Workstream status: Approval · Agent is waiting for approval',
			{ timeout: 30_000 },
		);
		await expect(starterStatus).not.toHaveAccessibleName(NEEDS_YOU);
		await row(page, child.workstreamId).click();
		const decision = page.getByRole('group', { name: 'Permission decision' });
		await expect(decision).toBeVisible({ timeout: 30_000 });

		await decision.getByRole('button', { name: 'Allow once' }).click();
		await expect(decision).toHaveCount(0);
		await expect(starterStatus).not.toHaveAccessibleName(NEEDS_YOU);
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
