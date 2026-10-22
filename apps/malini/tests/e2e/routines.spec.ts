import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

async function openRoutines(page: Page): Promise<void> {
	await page.evaluate(() => {
		globalThis.location.hash = '#/jobs/routines';
	});
	await page.reload();
	await expect(page.getByRole('form', { name: 'New routine' })).toBeVisible({ timeout: 20_000 });
}

async function chooseCommand(field: Locator, command: string): Promise<void> {
	const tag = await field.evaluate((element) => element.tagName);
	if (tag === 'SELECT') await field.selectOption(command);
	else await field.fill(command);
}

function steps(page: Page, label: string): Locator {
	return page.getByRole('list', { name: `Steps of ${label}` }).getByRole('listitem');
}

async function jobNames(page: Page): Promise<string[]> {
	const definitions = await invoke<{ name: string }[]>(page, 'jobs.list-definitions', undefined);
	return definitions.map(({ name }) => name);
}

test('the routine editor builds ordered steps of jobs and extension commands, refuses a job step without a job, and edits a routine in place', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openRoutines(page);
		const form = page.getByRole('form', { name: 'New routine' });
		await form.getByRole('textbox', { name: 'Label' }).fill('Fix, refresh, rebase');
		await form
			.getByRole('combobox', { name: 'Job for step 1' })
			.selectOption({ label: 'Fix checks' });
		await form.getByRole('button', { name: 'Add a step' }).click();
		await form.getByRole('combobox', { name: 'Kind of step 2' }).selectOption('command');
		await chooseCommand(form.getByLabel('Command for step 2'), 'malini.repository.refresh');
		await form.getByRole('button', { name: 'Add a step' }).click();
		await form
			.getByRole('combobox', { name: 'Job for step 3' })
			.selectOption({ label: 'Update from main' });
		await form.getByRole('button', { name: 'Move step 3 up' }).click();
		await form.getByRole('button', { name: 'Move step 1 down' }).click();
		await form.getByRole('button', { name: 'Create the draft routine' }).click();

		await expect(steps(page, 'Fix, refresh, rebase')).toHaveText([
			'1. Job · Update from main',
			'2. Job · Fix checks',
			'3. Extension command · malini.repository.refresh',
		]);
		await expect(form.getByRole('textbox', { name: 'Label' })).toHaveValue('');
		await captureFlow(app, 'routines-steps');

		await form.getByRole('textbox', { name: 'Label' }).fill('Half finished');
		await expect(form.getByRole('button', { name: 'Remove step 1' })).toBeDisabled();
		await form.getByRole('button', { name: 'Add a step' }).click();
		await form
			.getByRole('combobox', { name: 'Job for step 2' })
			.selectOption({ label: 'Fix checks' });
		await form.getByRole('button', { name: 'Remove step 1' }).click();
		await expect(form.getByRole('combobox', { name: 'Job for step 2' })).toHaveCount(0);
		await form.getByRole('button', { name: 'Add a step' }).click();
		await form.getByRole('button', { name: 'Create the draft routine' }).click();
		await expect(form.getByRole('alert')).toContainText('Step 2: choose the job to run.');
		await expect(page.getByRole('list', { name: 'Steps of Half finished' })).toHaveCount(0);

		await page.getByRole('button', { name: 'Edit Fix, refresh, rebase' }).click();
		const editing = page.getByRole('form', { name: 'Editing Fix, refresh, rebase' });
		await editing.getByRole('button', { name: 'Move step 2 up' }).click();
		await editing.getByRole('button', { name: 'Save Fix, refresh, rebase' }).click();
		await expect(editing).toHaveCount(0);
		await expect(steps(page, 'Fix, refresh, rebase')).toHaveText([
			'1. Job · Fix checks',
			'2. Job · Update from main',
			'3. Extension command · malini.repository.refresh',
		]);
		await openRoutines(page);
		await expect(steps(page, 'Fix, refresh, rebase').first()).toHaveText('1. Job · Fix checks');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a prompt sent three times becomes a suggestion whose job goes away when you stop accepting it, and Run now says why a routine failed', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-routines',
			'Routines workstream',
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

		await openRoutines(page);
		const accept = page.getByRole('button', { name: 'Accept this suggestion as a draft routine' });
		await accept.click();
		const form = page.getByRole('form', { name: 'New routine' });
		await expect(form).toContainText('keeps its 3 prompts as evidence');
		await expect(form.getByRole('textbox', { name: 'Label' })).toHaveValue(repeated);
		await expect.poll(() => jobNames(page)).toContain(repeated);
		await captureFlow(app, 'routines-suggestion');

		await form.getByRole('button', { name: 'Stop accepting this suggestion' }).click();
		await expect.poll(() => jobNames(page)).not.toContain(repeated);

		const job = await invoke<{ id: string }>(page, 'jobs.save-definition', {
			name: 'Red tests',
			instructions: 'ROUTINE_RUN_FAIL',
			model: 'opus',
			effort: 'medium',
			runsIn: 'workstream',
			output: 'none',
			skills: [],
		});
		await invoke(page, 'routines.create-draft', {
			label: 'Check the tests',
			when: 'when I run it',
			steps: [{ job: job.id }],
		});
		await openRoutines(page);
		await page
			.getByRole('combobox', { name: 'Workstream to run Check the tests in' })
			.selectOption(seeded.workstreamId);
		await page.getByRole('button', { name: 'Run Check the tests now' }).click();
		await expect(
			page.getByRole('alert').filter({ hasText: 'the tests are still red' }),
		).toBeVisible({ timeout: 30_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a held routine run names the workstream it waits in', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-routines-held',
			'Held workstream',
		);
		const definitions = await invoke<{ id: string; name: string }[]>(
			page,
			'jobs.list-definitions',
			undefined,
		);
		const fixChecks = definitions.find(({ name }) => name === 'Fix checks');
		if (!fixChecks) throw new Error('the built-in Fix checks job is missing');
		const routine = await invoke<{ id: string }>(page, 'routines.create-draft', {
			label: 'Check after updates',
			when: 'on app:updated',
			steps: [{ job: fixChecks.id }],
		});
		await invoke(page, 'routines.promote', { routineId: routine.id });
		await invoke(page, 'routines.record-gated-run', {
			id: 'e2e-gated-run',
			routineId: routine.id,
			workstreamId,
			runKey: 'app-updated-2.5.0',
			event: 'app:updated',
			payload: { version: '2.5.0' },
		});

		await openRoutines(page);
		const confirm = page.getByRole('button', { name: 'Confirm this app:updated run' });
		await expect(confirm).toBeVisible({ timeout: 20_000 });
		await expect(confirm.locator('xpath=ancestor::li[1]')).toContainText(
			'Held: app:updated in Held workstream',
		);
		await captureFlow(app, 'routines-held-run');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
