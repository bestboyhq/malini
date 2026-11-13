import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openAutomations,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';
import { seedWorkstreamOnFakeGithub } from './fake-github';

type AutomationRow = Readonly<{ id: string; name: string; builtin: string | null }>;

type RunRow = Readonly<{
	id: string;
	title: string;
	status: string;
	origin: string;
	parentRunId: string | null;
	workstreamId: string | null;
	detail: string | null;
}>;

async function saveAutomation(
	page: Page,
	automation: Readonly<{
		name: string;
		instructions: string;
		trigger?: Readonly<{ when: string; mode: string }>;
		thenAutomationId?: string;
	}>,
): Promise<AutomationRow> {
	return invoke<AutomationRow>(page, 'automations.save-definition', {
		model: 'opus',
		effort: 'medium',
		runsIn: 'workstream',
		...automation,
	});
}

async function builtinId(page: Page, builtin: string): Promise<string> {
	const automations = await invoke<AutomationRow[]>(
		page,
		'automations.list-definitions',
		undefined,
	);
	const automation = automations.find((candidate) => candidate.builtin === builtin);
	if (!automation) throw new Error(`the built-in ${builtin} automation is missing`);
	return automation.id;
}

async function runsOf(page: Page, title: string): Promise<RunRow[]> {
	const runs = await invoke<RunRow[]>(page, 'automations.list-runs', undefined);
	return runs.filter((run) => run.title === title);
}

test('an automation whose Then is Open draft asks the runner for it once the automation succeeds, and the draft opens', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-then', null);
		const automation = await saveAutomation(page, {
			name: 'Add alpha',
			instructions: 'EDIT:alpha.txt',
			thenAutomationId: await builtinId(page, 'open-draft'),
		});
		const started = await invoke<RunRow>(page, 'automations.run', {
			definitionId: automation.id,
			workstreamId: 'e2e-then',
		});

		await expect
			.poll(async () => (await runsOf(page, 'Open draft'))[0], { timeout: 60_000 })
			.toMatchObject({
				origin: 'then',
				parentRunId: started.id,
				workstreamId: 'e2e-then',
				status: 'succeeded',
			});
		expect((await runsOf(page, 'Add alpha'))[0]?.status).toBe('succeeded');
		await expect
			.poll(() => github.pullRequest(), { timeout: 60_000 })
			.toMatchObject({
				isDraft: true,
			});

		await openAutomations(page, '#/automations/activity');
		const followed = page
			.getByRole('listitem')
			.filter({ hasText: 'Open draft' })
			.filter({ hasText: 'After Add alpha' });
		await expect(followed).toHaveCount(1);
		await captureFlow(app, 'automation-then-open-draft');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an automation whose agent goes on after its background command runs again, holds its Then until it ends, and its edits commit under its own Commit line', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, worktree } = await seedWorkstreamOnFakeGithub(app, 'e2e-goes-on', null);
		const then = await saveAutomation(page, { name: 'Note after', instructions: 'EDIT:then.txt' });
		const automation = await saveAutomation(page, {
			name: 'Warm-up note',
			instructions: 'BACKGROUND_GOES_ON',
			thenAutomationId: then.id,
		});
		await invoke(page, 'automations.run', {
			definitionId: automation.id,
			workstreamId: 'e2e-goes-on',
		});
		const status = async (title: string) => (await runsOf(page, title))[0]?.status;

		await expect.poll(() => status('Warm-up note'), { timeout: 30_000 }).toBe('succeeded');
		await expect.poll(() => status('Note after'), { timeout: 30_000 }).toBe('queued');
		await openAutomations(page, '#/automations/activity');
		await captureFlow(app, 'automation-background-wait');

		writeFileSync(join(app.home, 'end-background-command'), '');
		await expect.poll(() => status('Warm-up note'), { timeout: 30_000 }).toBe('running');
		expect(await status('Note after')).toBe('queued');

		writeFileSync(join(app.home, 'end-background-turn'), '');
		await expect
			.poll(async () => (await runsOf(page, 'Warm-up note'))[0]?.detail, { timeout: 30_000 })
			.toContain('Outcome: The e2e suite passes');
		await expect.poll(() => status('Note after'), { timeout: 30_000 }).toBe('succeeded');
		expect(await runsOf(page, 'Note after')).toHaveLength(1);
		const git = (args: readonly string[]) =>
			execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' });
		await expect
			.poll(() => git(['log', '--name-only', '--format=', 'main..HEAD']).split('\n').sort(), {
				timeout: 30_000,
			})
			.toEqual(expect.arrayContaining(['flaky.txt', 'then.txt']));
		expect(git(['status', '--porcelain'])).toBe('');
		expect(git(['log', '--format=%s', 'main..HEAD']).trim().split('\n')).toContain(
			'test: fix the flaky test',
		);
		await captureFlow(app, 'automation-background-went-on');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a trigger set to Ask me first leaves a waiting run that Run it starts and Skip cancels, and a trigger never re-starts its own chain', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-waiting',
			'Waiting workstream',
		);
		const poke = await saveAutomation(page, { name: 'Poke', instructions: 'Hello' });
		await saveAutomation(page, {
			name: 'Note it',
			instructions: 'Hello',
			trigger: {
				when: 'on automations:run-finished where run.title is Poke and run.status is succeeded',
				mode: 'ask',
			},
		});

		const first = await invoke<RunRow>(page, 'automations.run', {
			definitionId: poke.id,
			workstreamId,
		});
		await expect
			.poll(async () => (await runsOf(page, 'Note it'))[0], { timeout: 60_000 })
			.toMatchObject({ status: 'waiting', origin: 'trigger', parentRunId: first.id, workstreamId });

		const topBarAutomations = page.getByTestId('global-topbar-automations');
		await expect(topBarAutomations).toHaveAccessibleName('Automations, 1 needs you', {
			timeout: 30_000,
		});
		await openWorkstream(page, workstreamId);
		const line = page
			.getByRole('list', { name: 'Automations', exact: true })
			.getByRole('button', { name: 'Note it, Wants to run', exact: true });
		await line.click({ timeout: 30_000 });
		const waiting = page
			.getByRole('dialog', { name: 'Note it, Wants to run' })
			.getByRole('group', { name: 'Note it in Waiting workstream: Wants to run' });
		await expect(waiting).toBeVisible();
		await expect(waiting).toContainText('After Poke');
		await expect(waiting).not.toContainText('Last run');
		await captureFlow(app, 'automation-waiting-run');
		await waiting.getByRole('button', { name: 'Run it: Note it' }).click();
		await expect(waiting).toHaveCount(0);
		await expect
			.poll(async () => (await runsOf(page, 'Note it'))[0]?.status, { timeout: 60_000 })
			.toBe('succeeded');

		await invoke(page, 'automations.run', { definitionId: poke.id, workstreamId });
		await line.click({ timeout: 60_000 });
		await expect(waiting).toBeVisible();
		await expect(waiting).toContainText('Last run');
		await waiting.getByRole('button', { name: 'Skip Note it' }).click();
		await expect(waiting).toHaveCount(0);
		await expect(topBarAutomations).toHaveAccessibleName('Automations');
		await expect
			.poll(async () => (await runsOf(page, 'Note it')).map(({ status }) => status))
			.toEqual(['cancelled', 'succeeded']);

		const echo = await saveAutomation(page, {
			name: 'Echo',
			instructions: 'Hello',
			trigger: {
				when: 'on automations:run-changed where run.title is Echo and run.status is succeeded',
				mode: 'auto',
			},
		});
		await invoke(page, 'automations.run', { definitionId: echo.id, workstreamId });
		await expect
			.poll(async () => (await runsOf(page, 'Echo'))[0]?.status, { timeout: 60_000 })
			.toBe('succeeded');
		await page.waitForTimeout(3_000);
		expect(await runsOf(page, 'Echo')).toHaveLength(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the same ask after two merges in a repository is suggested under the reply, and Save it keeps the edited automation', async () => {
	test.setTimeout(180_000);
	const first = await launchMalini();
	let projectId: string;
	try {
		const source = await createSourceRepo(first.root);
		projectId = (await seedWorkstream(first.page, source, 'e2e-merged-a', 'Merged first'))
			.projectId;
		await seedWorkstream(first.page, source, 'e2e-merged-b', 'Merged second');
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}
	const anHourAgo = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
	const db = new DatabaseSync(join(first.userDataDir, 'malini.sqlite'));
	const logMerge = db.prepare(
		"INSERT INTO event_log (channel, payload, workstream_id, chain_id, emitted_at, handled_at) VALUES ('pull-requests:ship-changed', ?, ?, ?, ?, ?)",
	);
	for (const [workstreamId, pullRequestNumber] of [
		['e2e-merged-a', 75],
		['e2e-merged-b', 73],
	] as const) {
		const merged = { pullRequestNumber, pullRequestUrl: null };
		logMerge.run(
			JSON.stringify({ workstreamId, state: null, merged }),
			workstreamId,
			`e2e-merge-${pullRequestNumber}`,
			anHourAgo,
			anHourAgo,
		);
	}
	db.close();

	const ask = 'Did the changelog entry go out?';
	const app = await launchMalini({
		profile: first.root,
		env: {
			FAKE_BRIDGE_ANSWER: JSON.stringify({
				same: [1],
				name: 'Check the changelog',
				instructions: 'Check that the changelog has an entry for the merged pull request.',
			}),
		},
	});
	try {
		const { page } = app;
		await openWorkstream(page, 'e2e-merged-a');
		await sendPrompt(page, ask);
		await expectAssistantReply(page);
		const suggested = page.getByRole('region', { name: 'Suggested automation' });
		await expect(suggested).toHaveCount(0);

		await openWorkstream(page, 'e2e-merged-b');
		await sendPrompt(page, ask);
		await expectAssistantReply(page);
		await expect(suggested).toBeVisible({ timeout: 30_000 });
		await expect(suggested).toContainText('A pull request merges in source');
		await expect(suggested).toContainText('Check that the changelog has an entry');
		await expect(suggested).toContainText('Ask me first, in a new workstream');
		await suggested.getByText('Suggested automation').hover();
		await expect(page.getByRole('tooltip')).toHaveText('You asked this after #73 and #75 merged.');
		await captureFlow(app, 'automation-suggestion');

		await suggested.getByRole('button', { name: 'Edit' }).click();
		const name = suggested.getByRole('textbox', { name: 'Automation name' });
		await expect(name).toBeFocused();
		await name.fill('Changelog after a merge');
		await suggested.getByRole('radio', { name: 'On its own' }).click();
		await captureFlow(app, 'automation-suggestion-edit');
		await suggested.getByRole('button', { name: 'Save it' }).click();
		await expect(suggested).toContainText('Saved as an automation', { timeout: 20_000 });
		await expect(suggested.getByRole('link', { name: 'Open' })).toBeVisible();
		await expect(suggested).toContainText('On its own, in a new workstream');

		const automations = await invoke<
			(AutomationRow & Readonly<{ trigger: Readonly<{ when: string; mode: string }> | null }>)[]
		>(page, 'automations.list-definitions', undefined);
		expect(automations.find(({ name }) => name === 'Changelog after a merge')?.trigger).toEqual({
			when: `on pull-requests:ship-changed where merged is set and repositoryId is ${projectId}`,
			mode: 'auto',
		});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an automation asked for twice before it starts runs once, and its row says how often it was asked', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-asked-twice',
			'Asked twice',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'HANG');
		await expect
			.poll(() => invoke(page, 'chat.workstream-has-working-run', { workstreamId }))
			.toBe(true);
		const automation = await saveAutomation(page, { name: 'Bump version', instructions: 'Hello' });
		const ask = (context: string) =>
			invoke<RunRow & Readonly<{ requests: number }>>(page, 'automations.run', {
				definitionId: automation.id,
				workstreamId,
				context,
			});

		const first = await ask('Version 2.1');
		const second = await ask('Version 2.2');

		expect(second).toMatchObject({ id: first.id, status: 'queued', requests: 2 });
		expect(await runsOf(page, 'Bump version')).toHaveLength(1);
		await openAutomations(page, '#/automations/activity');
		await expect(
			page.getByTestId('automation-run-row').filter({ hasText: 'Bump version' }),
		).toContainText('Asked 2 times');
		await captureFlow(app, 'automation-asked-twice');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a run that needs you stays on Activity and its row cancels it', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-needs-you',
			'Needs you workstream',
		);
		const automation = await saveAutomation(page, {
			name: 'Read outside',
			instructions: 'APPROVAL',
		});
		await invoke(page, 'automations.run', { definitionId: automation.id, workstreamId });
		await expect
			.poll(async () => (await runsOf(page, 'Read outside'))[0]?.status, { timeout: 60_000 })
			.toBe('needs-you');

		await openAutomations(page, '#/automations/activity');
		const row = page.getByTestId('automation-run-row').filter({ hasText: 'Read outside' });
		await expect(row).toHaveCount(1);
		await row.getByRole('button', { name: 'Cancel Read outside' }).click();
		await row.getByRole('button', { name: 'Confirm cancelling Read outside' }).click();

		await expect
			.poll(async () => (await runsOf(page, 'Read outside'))[0]?.status, { timeout: 30_000 })
			.toBe('cancelled');
		await captureFlow(app, 'automation-needs-you-cancelled');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a Malini call you deny for an automation is kept as denied, and its run ends the way its agent run ended', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-denied-call',
			'Denied call',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Plan the cleanup');
		await expectAssistantReply(page);
		const chat = currentSessionId(page);
		if (!chat) throw new Error('the chat did not commit a session id');
		writeFileSync(
			join(app.home, 'malini-tool.json'),
			JSON.stringify({ tool: 'repositories_hide', input: { repository: 'acme/api' } }),
		);
		const automation = await saveAutomation(page, {
			name: 'Tidy repositories',
			instructions: 'MALINI_TOOL',
		});
		await invoke(page, 'automations.run', {
			definitionId: automation.id,
			workstreamId,
			chatSessionId: chat,
		});
		await expect
			.poll(async () => (await runsOf(page, 'Tidy repositories'))[0]?.status, { timeout: 30_000 })
			.toBe('needs-you');

		const asking = page.getByRole('region', {
			name: 'Tidy repositories automation in Denied call needs you',
		});
		await asking
			.getByRole('group', { name: 'Permission decision' })
			.getByRole('button', { name: 'Deny' })
			.click();
		await expect(asking).toHaveCount(0, { timeout: 20_000 });

		await expect
			.poll(async () => (await runsOf(page, 'Tidy repositories'))[0]?.status, { timeout: 30_000 })
			.toBe('succeeded');
		expect(
			await invoke<Readonly<{ tool: string; status: string; approval: string }>[]>(
				page,
				'automations.list-agent-actions',
				undefined,
			),
		).toEqual([
			expect.objectContaining({ tool: 'repositories_hide', status: 'denied', approval: 'denied' }),
		]);
		await captureFlow(app, 'automation-denied-call');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
