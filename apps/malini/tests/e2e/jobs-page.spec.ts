import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	draftJob,
	expectCleanConsole,
	invoke,
	jobCard,
	launchMalini,
	openJob,
	openJobs,
	openOverview,
} from './harness';

type JobRow = Readonly<{
	id: string;
	name: string;
	builtin: string | null;
	instructions: string;
	trigger: Readonly<{ when: string; mode: string }> | null;
	thenJobId: string | null;
}>;

async function jobs(page: Page): Promise<JobRow[]> {
	return invoke<JobRow[]>(page, 'jobs.list-definitions', undefined);
}

async function jobNamed(page: Page, name: string): Promise<JobRow | undefined> {
	return (await jobs(page)).find((job) => job.name === name);
}

async function builtinId(page: Page, builtin: string): Promise<string> {
	const job = (await jobs(page)).find((candidate) => candidate.builtin === builtin);
	if (!job) throw new Error(`the built-in ${builtin} job is missing`);
	return job.id;
}

test('the Jobs page slides the sidebar into its sections and opens the job its address names as its own page', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openJobs(page);
		await expect(page).toHaveTitle('Malini · Automations');
		const sections = page.getByRole('navigation', { name: 'Automations' });
		await expect(sections.getByRole('link', { name: 'Overview' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(sections.getByRole('link', { name: /^Routines/u })).toHaveCount(0);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Automations');
		await expect(page.getByRole('region', { name: 'Your jobs' }).getByRole('article')).toHaveCount(
			11,
		);

		for (const [name, title] of [
			['Activity', 'Activity'],
			['Explorer', 'Explorer'],
			['Recipes', 'Recipes'],
		] as const) {
			await sections.getByRole('link', { name: new RegExp(`^${name}`, 'u') }).click();
			await expect(page).toHaveTitle(`Malini · ${title}`);
			await expect(
				sections.getByRole('link', { name: new RegExp(`^${name}`, 'u') }),
			).toHaveAttribute('aria-current', 'page');
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
		}

		await page.getByRole('button', { name: 'Use Changelog on merge' }).click();
		await expect(page).toHaveURL(/#\/jobs$/u);
		await expect(page.getByRole('article', { name: 'New job draft' })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Job name' })).toHaveValue('Changelog on merge');
		await page.getByRole('button', { name: 'Discard draft' }).click();
		await expect(page.getByRole('article', { name: 'New job draft' })).toHaveCount(0);

		await page.getByRole('link', { name: 'Set up Update from main' }).click();
		await expect(page).toHaveURL(/#\/jobs\/[^/]+$/u);
		await expect(page.getByRole('link', { name: 'Update from main', exact: true })).toHaveAttribute(
			'aria-current',
			'page',
		);
		const detail = page.getByRole('region', { name: 'Update from main', exact: true });
		await expect(detail).toContainText('The merge queue runs it when a branch it is shipping');
		await expect(detail).toContainText('Resolve conflicts, when the merge stops on conflicts');
		await expect(detail.getByRole('textbox', { name: 'Instructions' })).toHaveCount(0);

		await page.reload();
		await expect(detail).toBeVisible({ timeout: 20_000 });
		await sections.getByRole('link', { name: 'Overview' }).click();
		await expect(detail).toHaveCount(0);
		await expect(page).toHaveURL(/#\/jobs$/u);

		await page.getByRole('link', { name: 'Set up Update from main' }).click();
		await sections.getByRole('link', { name: 'Overview' }).click();
		await page.evaluate(() => {
			globalThis.location.hash = '#/jobs';
		});
		await page.getByRole('link', { name: 'Set up Merge' }).click();
		const merge = page.getByRole('region', { name: 'Merge', exact: true });
		await expect(merge).toBeVisible();
		await page.waitForTimeout(1_000);
		await expect(merge).toBeVisible();
		await sections.getByRole('link', { name: 'Overview' }).click();
		await expect(merge).toHaveCount(0);

		await openJobs(page, '#/jobs/routines');
		await expect(page).toHaveURL(/#\/jobs$/u);
		await expect(page).toHaveTitle('Malini · Automations');

		await page.getByRole('link', { name: 'Workstreams' }).click();
		await expect(sections).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test("a job's When, run mode and Then are fields of the job, and a Then that would loop is refused", async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openJobs(page);
		await page
			.getByRole('textbox', { name: 'What should happen, and when?' })
			.fill('When a pull request merges, update CHANGELOG.md and open a draft PR');
		await expect(page.getByText('Malini reads')).toBeVisible();
		await page.getByRole('button', { name: /^Draft it/u }).click();
		const draft = page.getByRole('article', { name: 'New job draft' });
		await expect(draft.getByRole('textbox', { name: 'Step 1' })).toHaveValue('Update CHANGELOG.md');
		await expect(
			draft.getByRole('button', { name: /runs: A pull request merges$/u }),
		).toBeVisible();
		await expect(draft.getByRole('button', { name: 'Then: Open draft' })).toBeVisible();
		await expect(draft.getByRole('radio', { name: 'Ask me first' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
		await captureFlow(app, 'jobs-draft');
		await draft.getByRole('button', { name: 'Save job' }).click();

		const card = jobCard(page, 'Changelog on merge');
		await expect(card).toContainText('When a pull request merges');
		await expect(card).toContainText('Ask me first');
		const openDraft = await builtinId(page, 'open-draft');
		await expect
			.poll(() => jobNamed(page, 'Changelog on merge'))
			.toMatchObject({
				instructions: 'Update CHANGELOG.md',
				trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'ask' },
				thenJobId: openDraft,
			});

		await card.getByRole('switch', { name: 'Changelog on merge' }).click();
		await expect(card).toContainText('Off');
		await expect
			.poll(async () => (await jobNamed(page, 'Changelog on merge'))?.trigger?.mode)
			.toBe('off');
		await card.getByRole('switch', { name: 'Changelog on merge' }).click();
		await expect
			.poll(async () => (await jobNamed(page, 'Changelog on merge'))?.trigger?.mode)
			.toBe('ask');

		const detail = await openJob(page, 'Changelog on merge');
		await detail.getByRole('radio', { name: 'On its own' }).click();
		await expect
			.poll(async () => (await jobNamed(page, 'Changelog on merge'))?.trigger?.mode)
			.toBe('auto');
		await expect(detail).toContainText(
			'runs in the workstream it fires in and then runs Open draft.',
		);
		await captureFlow(app, 'jobs-detail');

		await detail.getByRole('button', { name: 'Then: Open draft' }).click();
		await page.getByRole('menuitemradio', { name: 'Merge' }).click();
		const merge = await builtinId(page, 'merge');
		await expect
			.poll(async () => (await jobNamed(page, 'Changelog on merge'))?.thenJobId)
			.toBe(merge);
		await expect(detail).toContainText('and then runs Merge.');

		await detail.getByRole('button', { name: /^When Changelog on merge runs: /u }).click();
		const picker = page.getByRole('dialog', { name: 'When should it run' });
		await picker.getByRole('button', { name: 'Any Malini event…' }).click();
		await picker.getByRole('combobox', { name: 'Event' }).selectOption('chat:session-renamed');
		await picker.getByRole('button', { name: 'Use this event' }).click();
		await expect(picker).toHaveCount(0);
		await expect
			.poll(async () => (await jobNamed(page, 'Changelog on merge'))?.trigger)
			.toEqual({ when: 'on chat:session-renamed', mode: 'auto' });

		await detail.getByRole('button', { name: /^When Changelog on merge runs: /u }).click();
		await picker.getByRole('option', { name: /^When you run it/u }).click();
		await expect(picker).toHaveCount(0);
		await expect.poll(async () => (await jobNamed(page, 'Changelog on merge'))?.trigger).toBeNull();
		await expect(detail.getByRole('radiogroup')).toHaveCount(0);

		await openOverview(page);
		await draftJob(page, { name: 'Release notes', words: 'Write the release notes' });
		const changelog = await jobNamed(page, 'Changelog on merge');
		const notes = await jobNamed(page, 'Release notes');
		if (!changelog || !notes) throw new Error('the drafted jobs are missing');
		const notesDetail = await openJob(page, 'Release notes');
		await notesDetail.getByRole('button', { name: 'Then: Nothing' }).click();
		await page.getByRole('menuitemradio', { name: 'Changelog on merge' }).click();
		await expect
			.poll(async () => (await jobNamed(page, 'Release notes'))?.thenJobId)
			.toBe(changelog.id);
		await openOverview(page);

		const loop = await openJob(page, 'Changelog on merge');
		await loop.getByRole('button', { name: 'Then: Merge' }).click();
		await page.getByRole('menuitemradio', { name: 'Release notes' }).click();
		await expect(loop.getByRole('alert')).toContainText('loop');
		await expect
			.poll(async () => (await jobNamed(page, 'Changelog on merge'))?.thenJobId)
			.toBe(merge);

		await loop.getByRole('button', { name: 'Delete Changelog on merge' }).click();
		await loop.getByRole('button', { name: 'Confirm deleting Changelog on merge' }).click();
		await expect(loop).toHaveCount(0);
		await expect(card).toHaveCount(0);
		await expect.poll(async () => (await jobNamed(page, 'Release notes'))?.thenJobId).toBeNull();
		await expect(jobCard(page, 'Release notes')).toContainText('Runs when you run it');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a job runs on a schedule, in its own chat at Home or in the repository you pick', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		await invoke(page, 'repositories.create-repository', { repoUrl: `file://${api}` });
		await openJobs(page);
		await page
			.getByRole('textbox', { name: 'What should happen, and when?' })
			.fill('Every weekday at 9:00, triage new issues');
		await expect(page.getByText('Every weekday at 9:00', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: /^Draft it/u }).click();
		const draft = page.getByRole('article', { name: 'New job draft' });
		await expect(
			draft.getByRole('button', { name: /runs: Every weekday at 9:00$/u }),
		).toBeVisible();
		await expect(draft.getByRole('button', { name: 'Runs in: Home' })).toBeVisible();
		await draft.getByRole('button', { name: 'Save job' }).click();
		await expect
			.poll(() => jobNamed(page, 'Triage new issues'))
			.toMatchObject({ trigger: { when: 'every weekday at 09:00', mode: 'ask' } });

		const detail = await openJob(page, 'Triage new issues');
		await expect(detail).toContainText(
			'Every weekday at 9:00, Triage new issues runs in its own chat at Home. It asks you first.',
		);
		await detail.getByRole('button', { name: /^When Triage new issues runs: /u }).click();
		const picker = page.getByRole('dialog', { name: 'When should it run' });
		await picker.getByRole('option', { name: /^Every weekday at 9:00/u }).click();
		await picker.getByRole('combobox', { name: 'Repeat' }).selectOption('monday');
		await picker.getByLabel('At', { exact: true }).fill('07:30');
		await expect(picker.getByText('every monday at 07:30', { exact: true })).toBeVisible();
		await captureFlow(app, 'jobs-schedule');
		await picker.getByRole('button', { name: 'Use this schedule' }).click();
		await expect(picker).toHaveCount(0);
		await expect
			.poll(async () => (await jobNamed(page, 'Triage new issues'))?.trigger?.when)
			.toBe('every monday at 07:30');

		await detail.getByRole('button', { name: 'Runs in: Home' }).click();
		await page.getByRole('menuitemradio', { name: 'acme/api' }).click();
		await expect
			.poll(async () => (await jobNamed(page, 'Triage new issues'))?.trigger?.when)
			.toBe('every monday at 07:30 in acme/api');
		await expect(detail).toContainText(
			'Every Monday at 7:30, Triage new issues runs in its own workstream of acme/api.',
		);
		await captureFlow(app, 'jobs-schedule-detail');

		await openOverview(page);
		const merge = await openJob(page, 'Merge');
		await merge.getByRole('button', { name: /^When Merge runs: /u }).click();
		await expect(picker.getByRole('option', { name: /^On a schedule/u })).toHaveCount(0);
		await page.keyboard.press('Escape');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the job center lists the scheduled jobs that are on, soonest first, says when the next one runs and opens a job from its row', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		await invoke(page, 'repositories.create-repository', { repoUrl: `file://${api}` });
		const clock = (date: Date): string =>
			[date.getHours(), date.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':');
		const now = new Date();
		const soon = new Date(now.getTime() + 2 * 60 * 60 * 1_000);
		const soonDay = soon.getDate() === now.getDate() ? 'Today' : 'Tomorrow';
		const later = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 7, 15);
		const laterDay = later.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
		const laterShort = later.toLocaleDateString('en-US', { weekday: 'short' });
		for (const [name, when, mode] of [
			['Weekly digest', `every ${laterDay} at 07:15`, 'auto'],
			['Triage issues', `every day at ${clock(soon)} in acme/api`, 'ask'],
			['Paused report', `every day at ${clock(soon)}`, 'off'],
		] as const) {
			await invoke(page, 'jobs.save-definition', {
				name,
				instructions: 'Hello',
				model: 'opus',
				effort: 'medium',
				runsIn: 'workstream',
				trigger: { when, mode },
			});
		}

		const center = page.getByRole('region', {
			name: `Jobs: next at ${clock(soon)} ${soonDay.toLowerCase()}`,
		});
		await expect(center).toBeVisible({ timeout: 20_000 });
		const upcoming = center.getByRole('list', { name: 'Upcoming jobs' }).getByRole('link');
		await expect(upcoming).toHaveCount(2);
		await expect(upcoming.nth(0)).toHaveAccessibleName(
			`Open Triage issues · Asks first · acme/api, next run ${soonDay} ${clock(soon)}`,
		);
		await expect(upcoming.nth(1)).toHaveAccessibleName(
			`Open Weekly digest · Home, next run ${laterShort} 07:15`,
		);
		await captureFlow(app, 'job-center-upcoming');

		await upcoming.nth(1).click();
		await expect(page.getByRole('region', { name: 'Weekly digest', exact: true })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
