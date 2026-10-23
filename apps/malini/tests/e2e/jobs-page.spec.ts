import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	draftJob,
	expectCleanConsole,
	invoke,
	jobCard,
	launchMalini,
	openJob,
	openJobs,
} from './harness';

type RoutineRow = Readonly<{ label: string; status: string; when: string }>;

async function routines(page: Page): Promise<RoutineRow[]> {
	return (await invoke<RoutineRow[]>(page, 'routines.list', undefined)).map(
		({ label, status, when }) => ({ label, status, when }),
	);
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
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Automations');
		await expect(page.getByRole('region', { name: 'Your jobs' }).getByRole('article')).toHaveCount(
			7,
		);

		for (const [name, title] of [
			['Activity', 'Activity'],
			['Routines', 'Routines'],
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

		await page.reload();
		await expect(detail).toBeVisible({ timeout: 20_000 });
		await sections.getByRole('link', { name: 'Overview' }).click();
		await expect(detail).toHaveCount(0);
		await expect(page).toHaveURL(/#\/jobs$/u);

		await page.getByRole('link', { name: 'Workstreams' }).click();
		await expect(sections).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test("a job's trigger and run mode are its own routine, and deleting the job deletes it", async () => {
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
		await expect(
			draft.getByRole('button', { name: 'When it finishes: Open a draft PR' }),
		).toBeVisible();
		await expect(draft.getByRole('radio', { name: 'Ask me first' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
		await captureFlow(app, 'jobs-draft');
		await draft.getByRole('button', { name: 'Save job' }).click();

		const card = jobCard(page, 'Changelog on merge');
		await expect(card).toContainText('When a pull request merges');
		await expect(card).toContainText('Ask me first');
		await expect
			.poll(() => routines(page))
			.toEqual([
				{
					label: 'Changelog on merge',
					status: 'candidate',
					when: 'on pull-requests:ship-changed where merged is set',
				},
			]);
		const jobs = await invoke<{ name: string; output: string; instructions: string }[]>(
			page,
			'jobs.list-definitions',
			undefined,
		);
		expect(jobs.find(({ name }) => name === 'Changelog on merge')).toMatchObject({
			output: 'draft',
			instructions: 'Update CHANGELOG.md',
		});

		await card.getByRole('switch', { name: 'Changelog on merge' }).click();
		await expect(card).toContainText('Off');
		await expect.poll(async () => (await routines(page))[0]?.status).toBe('draft');
		await card.getByRole('switch', { name: 'Changelog on merge' }).click();
		await expect.poll(async () => (await routines(page))[0]?.status).toBe('candidate');

		const detail = await openJob(page, 'Changelog on merge');
		await detail.getByRole('radio', { name: 'On its own' }).click();
		await expect.poll(async () => (await routines(page))[0]?.status).toBe('routine');
		await expect(detail).toContainText(
			'runs in the workstream it fires in and will open a draft PR',
		);
		await captureFlow(app, 'jobs-detail');

		await detail.getByRole('button', { name: /^When Changelog on merge runs: /u }).click();
		const picker = page.getByRole('dialog', { name: 'When should it run' });
		await picker.getByRole('button', { name: 'Any Malini event…' }).click();
		await picker.getByRole('combobox', { name: 'Event' }).selectOption('chat:session-renamed');
		await picker.getByRole('button', { name: 'Use this event' }).click();
		await expect(picker).toHaveCount(0);
		await expect.poll(async () => (await routines(page))[0]?.when).toBe('on chat:session-renamed');
		await expect(
			detail.getByRole('button', { name: 'When Changelog on merge runs: chat:session-renamed' }),
		).toBeVisible();

		await detail.getByRole('button', { name: /^When Changelog on merge runs: /u }).click();
		await picker.getByRole('option', { name: /^When you run it/u }).click();
		await expect(picker).toHaveCount(0);
		await expect.poll(() => routines(page)).toEqual([]);
		await expect(detail.getByRole('radiogroup')).toHaveCount(0);

		await detail.getByRole('button', { name: /^When Changelog on merge runs: /u }).click();
		await picker.getByRole('option', { name: /^A job fails/u }).click();
		await expect.poll(async () => (await routines(page)).length).toBe(1);

		await detail.getByRole('button', { name: 'Delete Changelog on merge' }).click();
		await detail.getByRole('button', { name: 'Confirm deleting Changelog on merge' }).click();
		await expect(detail).toHaveCount(0);
		await expect(card).toHaveCount(0);
		await expect.poll(() => routines(page)).toEqual([]);

		await draftJob(page, { name: 'By hand', words: 'Tidy the docs' });
		await expect(jobCard(page, 'By hand')).toContainText('Runs when you run it');
		expect(await routines(page)).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
