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
	openWorkstream,
	seedWorkstream,
} from './harness';

const WORKSTREAM = 'Jobs workstream';

async function runJob(page: Page, name: string): Promise<void> {
	const detail = await openJob(page, name);
	await detail.getByRole('button', { name: `Run ${name}` }).click();
	const target = detail.getByRole('group', { name: `Run ${name}` });
	await expect(target.getByRole('combobox', { name: 'Workstream' })).toContainText(WORKSTREAM);
	await target.getByRole('button', { name: 'Run job' }).click();
	await expect(target).toHaveCount(0);
	await openOverview(page);
	await expect(detail).toHaveCount(0);
}

test('the Jobs page lists your jobs then the built-in ones, drafts, edits, resets and deletes jobs behind confirmations', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openJobs(page);
		const cards = page.getByRole('region', { name: 'Your jobs' }).getByRole('article');
		await expect(cards).toHaveCount(10);
		for (const [index, name] of [
			'Name chats',
			'Name services',
			'Fix checks',
			'Update from main',
			'Resolve conflicts',
			'Address review',
			'Check compatibility',
			'Update docs',
			'Open draft',
			'Merge',
		].entries()) {
			await expect(cards.nth(index)).toHaveAccessibleName(name);
		}
		await expect(jobCard(page, 'Name chats')).toContainText('When you start a chat');
		await expect(jobCard(page, 'Name chats')).toContainText('Runs on its own');
		await expect(jobCard(page, 'Name chats').getByRole('switch')).toHaveCount(0);

		const nameChats = await openJob(page, 'Name chats');
		await expect(nameChats).toContainText(
			'When you start a chat, Name chats runs in the background.',
		);
		await expect(nameChats.getByRole('button', { name: 'Run Name chats' })).toHaveCount(0);
		await expect(nameChats.getByRole('button', { name: 'Delete Name chats' })).toHaveCount(0);
		await expect(nameChats.getByRole('button', { name: 'Reset Name chats' })).toBeVisible();
		await openOverview(page);

		const fixChecks = await openJob(page, 'Fix checks');
		const instructions = fixChecks.getByRole('textbox', { name: 'Instructions' });
		const original = await instructions.inputValue();
		await instructions.fill('Fix them my way.');
		await fixChecks.getByRole('button', { name: 'Save changes' }).click();
		await expect(fixChecks.getByRole('button', { name: 'Save changes' })).toBeDisabled();
		await fixChecks.getByRole('button', { name: 'Reset Fix checks' }).click();
		await expect(instructions).toHaveValue('Fix them my way.');
		await fixChecks.getByRole('button', { name: 'Confirm resetting Fix checks' }).click();
		await expect(instructions).toHaveValue(original);
		await openOverview(page);

		const composer = page.getByRole('textbox', { name: 'What should happen, and when?' });
		await composer.fill('Tidy the docs, then link every page from the index');
		await page.getByRole('button', { name: /^Draft it/u }).click();
		const draft = page.getByRole('article', { name: 'New job draft' });
		await expect(draft.getByRole('textbox', { name: 'Step 2' })).toHaveValue(
			'Link every page from the index',
		);
		await draft.getByRole('button', { name: 'Remove step 2' }).click();
		await draft.getByRole('button', { name: 'Remove step 1' }).click();
		await expect(draft.getByRole('button', { name: 'Save job' })).toBeDisabled();
		await draft.getByRole('button', { name: 'Discard', exact: true }).click();
		await expect(draft).toHaveCount(0);

		await draftJob(page, { name: 'Nightly docs', words: 'Tidy the docs' });
		await expect(cards.first()).toHaveAccessibleName('Nightly docs');
		const nightly = await openJob(page, 'Nightly docs');
		const save = nightly.getByRole('button', { name: 'Save changes' });
		await expect(save).toBeDisabled();
		await nightly.getByRole('textbox', { name: 'Name' }).fill('Weekly docs');
		await expect(save).toBeEnabled();
		await save.click();
		const weekly = page.getByRole('region', { name: 'Weekly docs', exact: true });
		await expect(weekly).toBeVisible();
		await weekly.getByRole('button', { name: 'Runs in: The workstream you pick' }).click();
		await page.getByRole('menuitemradio', { name: 'A new workstream' }).click();
		await expect
			.poll(async () =>
				(
					await invoke<{ name: string; runsIn: string }[]>(page, 'jobs.list-definitions', undefined)
				).find(({ name }) => name === 'Weekly docs'),
			)
			.toMatchObject({ runsIn: 'new-workstream' });
		await expect(weekly).toContainText('runs in a new workstream');
		await captureFlow(app, 'jobs-page');

		await weekly.getByRole('button', { name: 'Delete Weekly docs' }).click();
		await weekly.getByRole('button', { name: 'Keep' }).click();
		await expect(weekly.getByRole('button', { name: 'Delete Weekly docs' })).toBeVisible();
		await weekly.getByRole('button', { name: 'Delete Weekly docs' }).click();
		await weekly.getByRole('button', { name: 'Confirm deleting Weekly docs' }).click();
		await expect(weekly).toHaveCount(0);
		await expect(jobCard(page, 'Weekly docs')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the Job center appears with a job, puts the one that needs you first, holds a queued job closed until it starts, cancels only on the second click and folds finished jobs under Recent', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-job-center',
			WORKSTREAM,
		);
		await openWorkstream(page, seeded.workstreamId);
		const idle = page.getByRole('region', { name: 'Jobs: ready when you are' });
		await expect(idle).toBeVisible({ timeout: 20_000 });
		await expect(idle.getByRole('link', { name: 'Manage jobs' })).toBeVisible();
		await expect(page.getByTestId('sidebar-open-jobs')).not.toHaveAttribute('aria-describedby');

		await openJobs(page);
		await draftJob(page, { name: 'Ask first', words: 'QUESTION before you start' });
		await draftJob(page, { name: 'Keep going', words: 'HANG until stopped' });
		await runJob(page, 'Ask first');
		await runJob(page, 'Keep going');

		const jobsLink = page.getByTestId('sidebar-open-jobs');
		await expect(jobsLink).toHaveAccessibleDescription('1 job needs you', { timeout: 30_000 });
		await openWorkstream(page, seeded.workstreamId);
		const center = page.getByRole('region', { name: /^Jobs: .*1 needs you/u });
		await expect(center).toBeVisible({ timeout: 30_000 });
		const inProgress = center.getByRole('list', { name: 'Jobs in progress' });
		await expect(inProgress.getByRole('link').first()).toHaveAccessibleName(
			`Open transcript: Ask first · ${WORKSTREAM}, Needs you`,
		);
		await expect(center.getByRole('button', { name: 'Cancel Ask first' })).toHaveCount(0);
		await captureFlow(app, 'jobs-job-center');

		const queued = center.getByRole('button', {
			name: `Keep going · ${WORKSTREAM}, Queued. The transcript opens once the job starts`,
		});
		await expect(queued).toBeDisabled();

		await center.getByRole('button', { name: 'Cancel Keep going' }).click();
		const confirm = center.getByRole('button', { name: 'Confirm cancelling Keep going' });
		await expect(confirm).toHaveText('Cancel job');
		await expect(queued).toBeVisible();
		await confirm.click();
		const recent = center.getByRole('button', { name: /^Recent 1$/u });
		await expect(recent).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 });
		await recent.click();
		await expect(recent).toHaveAttribute('aria-expanded', 'true');
		await expect(
			center
				.getByRole('list', { name: 'Recent jobs' })
				.getByLabel(new RegExp(`Keep going · ${WORKSTREAM}, Cancelled`, 'u')),
		).toBeVisible();
		await expect(center.getByRole('button', { name: 'Cancel Keep going' })).toHaveCount(0);

		await inProgress
			.getByRole('link', { name: `Open transcript: Ask first · ${WORKSTREAM}, Needs you` })
			.click();
		await expect(page).toHaveURL(/agent=sess-/u);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
