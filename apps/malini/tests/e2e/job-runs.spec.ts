import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openJobs,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';
import { seedWorkstreamOnFakeGithub } from './fake-github';

type JobRow = Readonly<{ id: string; name: string; builtin: string | null }>;

type RunRow = Readonly<{
	id: string;
	title: string;
	status: string;
	origin: string;
	parentRunId: string | null;
	workstreamId: string | null;
}>;

async function saveJob(
	page: Page,
	job: Readonly<{
		name: string;
		instructions: string;
		trigger?: Readonly<{ when: string; mode: string }>;
		thenJobId?: string;
	}>,
): Promise<JobRow> {
	return invoke<JobRow>(page, 'jobs.save-definition', {
		model: 'opus',
		effort: 'medium',
		runsIn: 'workstream',
		...job,
	});
}

async function builtinId(page: Page, builtin: string): Promise<string> {
	const jobs = await invoke<JobRow[]>(page, 'jobs.list-definitions', undefined);
	const job = jobs.find((candidate) => candidate.builtin === builtin);
	if (!job) throw new Error(`the built-in ${builtin} job is missing`);
	return job.id;
}

async function runsOf(page: Page, title: string): Promise<RunRow[]> {
	const runs = await invoke<RunRow[]>(page, 'jobs.list-runs', undefined);
	return runs.filter((run) => run.title === title);
}

test('a job whose Then is Open draft asks the runner for it once the job succeeds, and the draft opens', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-then', null);
		const job = await saveJob(page, {
			name: 'Add alpha',
			instructions: 'EDIT:alpha.txt',
			thenJobId: await builtinId(page, 'open-draft'),
		});
		const started = await invoke<RunRow>(page, 'jobs.run', {
			definitionId: job.id,
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

		await openJobs(page, '#/jobs/activity');
		const followed = page
			.getByRole('listitem')
			.filter({ hasText: 'Open draft' })
			.filter({ hasText: 'After Add alpha' });
		await expect(followed).toHaveCount(1);
		await captureFlow(app, 'job-then-open-draft');
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
		const poke = await saveJob(page, { name: 'Poke', instructions: 'Hello' });
		await saveJob(page, {
			name: 'Note it',
			instructions: 'Hello',
			trigger: {
				when: 'on jobs:run-changed where run.title is Poke and run.status is succeeded',
				mode: 'ask',
			},
		});

		const first = await invoke<RunRow>(page, 'jobs.run', { definitionId: poke.id, workstreamId });
		await expect
			.poll(async () => (await runsOf(page, 'Note it'))[0], { timeout: 60_000 })
			.toMatchObject({ status: 'waiting', origin: 'trigger', parentRunId: first.id, workstreamId });

		await openJobs(page);
		const sections = page.getByRole('navigation', { name: 'Automations' });
		await expect(
			sections.getByRole('link', { name: /^Activity 1 waiting for you/u }),
		).toBeVisible();
		await sections.getByRole('link', { name: /^Activity/u }).click();
		const waiting = page.getByRole('group', { name: 'Note it wants to run' });
		await expect(waiting).toContainText('Waiting workstream');
		await captureFlow(app, 'job-waiting-run');
		await waiting.getByRole('button', { name: 'Run it: Note it' }).click();
		await expect(waiting).toHaveCount(0);
		await expect
			.poll(async () => (await runsOf(page, 'Note it'))[0]?.status, { timeout: 60_000 })
			.toBe('succeeded');

		await invoke(page, 'jobs.run', { definitionId: poke.id, workstreamId });
		await expect(waiting).toBeVisible({ timeout: 60_000 });
		await waiting.getByRole('button', { name: 'Skip Note it' }).click();
		await expect(waiting).toHaveCount(0);
		await expect(page.getByText('Nothing waits for you.')).toBeVisible();
		await expect
			.poll(async () => (await runsOf(page, 'Note it')).map(({ status }) => status))
			.toEqual(['cancelled', 'succeeded']);

		const echo = await saveJob(page, {
			name: 'Echo',
			instructions: 'Hello',
			trigger: {
				when: 'on jobs:run-changed where run.title is Echo and run.status is succeeded',
				mode: 'auto',
			},
		});
		await invoke(page, 'jobs.run', { definitionId: echo.id, workstreamId });
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

test('a prompt sent three times becomes a suggested job on the Overview, and Make it a job opens the new job', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-suggestions',
			'Suggestions workstream',
		);
		await openWorkstream(page, seeded.workstreamId);
		const repeated = 'Update the dependencies and run the tests';
		for (let sent = 1; sent <= 3; sent += 1) {
			await sendPrompt(page, repeated);
			await expect(page.getByText('Hello from the fake bridge')).toHaveCount(sent, {
				timeout: 30_000,
			});
		}
		await expectAssistantReply(page);

		await openJobs(page);
		const suggested = page.getByRole('listitem', { name: 'Suggested job' });
		await expect(suggested).toContainText('3 prompts like this');
		await expect(suggested).toContainText(repeated);
		await captureFlow(app, 'job-suggestion');
		await suggested.getByRole('button', { name: 'Make it a job' }).click();
		await expect(page.getByRole('region', { name: repeated, exact: true })).toBeVisible({
			timeout: 20_000,
		});
		await expect(suggested).toHaveCount(0);
		await expect
			.poll(async () =>
				(await invoke<JobRow[]>(page, 'jobs.list-definitions', undefined)).map(({ name }) => name),
			)
			.toContain(repeated);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a job asked for twice before it starts runs once, and its row says how often it was asked', async () => {
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
		const job = await saveJob(page, { name: 'Bump version', instructions: 'Hello' });
		const ask = (context: string) =>
			invoke<RunRow & Readonly<{ requests: number }>>(page, 'jobs.run', {
				definitionId: job.id,
				workstreamId,
				context,
			});

		const first = await ask('Version 2.1');
		const second = await ask('Version 2.2');

		expect(second).toMatchObject({ id: first.id, status: 'queued', requests: 2 });
		expect(await runsOf(page, 'Bump version')).toHaveLength(1);
		await openJobs(page, '#/jobs/activity');
		await expect(page.getByTestId('job-run-row').filter({ hasText: 'Bump version' })).toContainText(
			'Asked 2 times',
		);
		await captureFlow(app, 'job-asked-twice');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
