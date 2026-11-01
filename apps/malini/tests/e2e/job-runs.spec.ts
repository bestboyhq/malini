import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
	detail: string | null;
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

test('a job whose agent goes on after its background command runs again, holds its Then until it ends, and its edits commit under its own Commit line', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, worktree } = await seedWorkstreamOnFakeGithub(app, 'e2e-goes-on', null);
		const then = await saveJob(page, { name: 'Note after', instructions: 'EDIT:then.txt' });
		const job = await saveJob(page, {
			name: 'Warm-up note',
			instructions: 'BACKGROUND_GOES_ON',
			thenJobId: then.id,
		});
		await invoke(page, 'jobs.run', { definitionId: job.id, workstreamId: 'e2e-goes-on' });
		const status = async (title: string) => (await runsOf(page, title))[0]?.status;

		await expect.poll(() => status('Warm-up note'), { timeout: 30_000 }).toBe('succeeded');
		await expect.poll(() => status('Note after'), { timeout: 30_000 }).toBe('queued');
		await openJobs(page, '#/jobs/activity');
		await captureFlow(app, 'job-background-wait');

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
		await captureFlow(app, 'job-background-went-on');
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
				when: 'on jobs:run-finished where run.title is Poke and run.status is succeeded',
				mode: 'ask',
			},
		});

		const first = await invoke<RunRow>(page, 'jobs.run', { definitionId: poke.id, workstreamId });
		await expect
			.poll(async () => (await runsOf(page, 'Note it'))[0], { timeout: 60_000 })
			.toMatchObject({ status: 'waiting', origin: 'trigger', parentRunId: first.id, workstreamId });

		const center = page.getByRole('region', { name: /^Jobs: / });
		const row = center.getByRole('link', { name: 'Note it in Waiting workstream: Wants to run' });
		await expect(row).toBeVisible({ timeout: 30_000 });
		await expect(row).toHaveAttribute('aria-current', 'false');
		await row.click();
		await expect(page).toHaveURL(new RegExp(`/workstreams/${workstreamId}$`, 'u'));
		await expect(row).toHaveAttribute('aria-current', 'page');
		const waiting = page
			.getByRole('region', { name: /^Jobs \(\d+\)$/u })
			.getByRole('group', { name: 'Note it in Waiting workstream: Wants to run' });
		await expect(waiting).toBeVisible({ timeout: 30_000 });
		await expect(waiting).toContainText('After Poke');
		await expect(waiting).not.toContainText('Last run');
		await captureFlow(app, 'job-waiting-run');
		await waiting.getByRole('button', { name: 'Run it: Note it' }).click();
		await expect(waiting).toHaveCount(0);
		await expect
			.poll(async () => (await runsOf(page, 'Note it'))[0]?.status, { timeout: 60_000 })
			.toBe('succeeded');

		await invoke(page, 'jobs.run', { definitionId: poke.id, workstreamId });
		await expect(waiting).toBeVisible({ timeout: 60_000 });
		await expect(waiting).toContainText('Last run');
		await waiting.getByRole('button', { name: 'Skip Note it' }).click();
		await expect(waiting).toHaveCount(0);
		await expect(center).toHaveAccessibleName('Jobs: ready when you are');
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
