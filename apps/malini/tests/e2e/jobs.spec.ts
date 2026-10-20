import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

const WORKSTREAM = 'Jobs workstream';

async function openJobs(page: Page): Promise<void> {
	await page.evaluate(() => {
		globalThis.location.hash = '#/jobs';
	});
	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Jobs', exact: true })).toBeVisible({
		timeout: 20_000,
	});
}

async function createJob(page: Page, name: string, instructions: string): Promise<void> {
	await page.getByRole('link', { name: 'New job' }).click();
	const form = page.getByRole('form', { name: 'New job' });
	await form.getByRole('textbox', { name: 'Name' }).fill(name);
	await form.getByRole('textbox', { name: 'Instructions' }).fill(instructions);
	await form.getByRole('button', { name: 'Create job' }).click();
	await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
}

async function runJob(page: Page, name: string): Promise<void> {
	await page.getByRole('link', { name: new RegExp(`^${name}`, 'u') }).click();
	await page.getByRole('button', { name: `Run ${name}` }).click();
	const target = page.getByRole('group', { name: `Run ${name}` });
	await expect(target.getByRole('combobox', { name: 'Workstream' })).toContainText(WORKSTREAM);
	await target.getByRole('button', { name: 'Run job' }).click();
	await expect(target).toHaveCount(0);
}

test('the Jobs page lists the built-in jobs first, creates, edits, resets and deletes jobs behind confirmations', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openJobs(page);
		const builtIn = page.getByRole('region', { name: 'Built in' }).getByRole('link');
		await expect(builtIn).toHaveCount(7);
		for (const [index, name] of [
			'Name chats',
			'Name services',
			'Fix checks',
			'Update from main',
			'Address review',
			'Check compatibility',
			'Update docs',
		].entries()) {
			await expect(builtIn.nth(index)).toContainText(name);
		}
		await expect(page.getByRole('region', { name: 'Yours' })).toContainText(
			'Jobs you make show up here.',
		);
		await expect(builtIn.first()).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('heading', { name: 'Name chats', level: 2 })).toBeVisible();
		await expect(
			page.getByText('Runs on its own when you send the first message in a chat.'),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Run Name chats' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Delete Name chats' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Reset Name chats' })).toBeVisible();

		await builtIn.nth(2).click();
		const instructions = page.getByRole('textbox', { name: 'Instructions' });
		const original = await instructions.inputValue();
		await instructions.fill('Fix them my way.');
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
		await page.getByRole('button', { name: 'Reset Fix checks' }).click();
		await expect(instructions).toHaveValue('Fix them my way.');
		await page.getByRole('button', { name: 'Confirm resetting Fix checks' }).click();
		await expect(instructions).toHaveValue(original);

		await page.getByRole('link', { name: 'New job' }).click();
		const form = page.getByRole('form', { name: 'New job' });
		await form.getByRole('textbox', { name: 'Name' }).fill('   ');
		await form.getByRole('textbox', { name: 'Instructions' }).fill('Tidy the docs.');
		await form.getByRole('button', { name: 'Create job' }).click();
		await expect(form.getByRole('alert')).toHaveText('Give the job a name.');

		await form.getByRole('textbox', { name: 'Name' }).fill('Nightly docs');
		await form.getByRole('button', { name: 'Create job' }).click();
		const yours = page.getByRole('region', { name: 'Yours' }).getByRole('link');
		await expect(yours).toHaveCount(1);
		await expect(yours.first()).toContainText('Nightly docs');
		await expect(yours.first()).toHaveAttribute('aria-current', 'page');
		const save = page.getByRole('button', { name: 'Save changes' });
		await expect(save).toBeDisabled();
		await page.getByRole('textbox', { name: 'Name' }).fill('Weekly docs');
		await expect(save).toBeEnabled();
		await save.click();
		await expect(yours.first()).toContainText('Weekly docs');
		await expect
			.poll(async () =>
				(await invoke<{ name: string }[]>(page, 'jobs.list-definitions', undefined)).map(
					({ name }) => name,
				),
			)
			.toContain('Weekly docs');
		await captureFlow(app, 'jobs-page');

		await page.getByRole('button', { name: 'Delete Weekly docs' }).click();
		await page.getByRole('button', { name: 'Keep' }).click();
		await expect(yours).toHaveCount(1);
		await page.getByRole('button', { name: 'Delete Weekly docs' }).click();
		await page.getByRole('button', { name: 'Confirm deleting Weekly docs' }).click();
		await expect(yours).toHaveCount(0);
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
		await createJob(page, 'Ask first', 'QUESTION before you start');
		await createJob(page, 'Keep going', 'HANG until stopped');
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
