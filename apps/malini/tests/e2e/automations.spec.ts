import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	draftAutomation,
	expectCleanConsole,
	invoke,
	automationCard,
	launchMalini,
	openAutomation,
	openAutomations,
	openOverview,
	openWorkstream,
	seedWorkstream,
} from './harness';

const WORKSTREAM = 'Automations workstream';

async function runAutomation(page: Page, name: string): Promise<void> {
	const detail = await openAutomation(page, name);
	await detail.getByRole('button', { name: `Run ${name}` }).click();
	const target = detail.getByRole('group', { name: `Run ${name}` });
	await expect(target.getByRole('combobox', { name: 'Workstream' })).toContainText(WORKSTREAM);
	await target.getByRole('button', { name: 'Run automation' }).click();
	await expect(target).toHaveCount(0);
	await openOverview(page);
	await expect(detail).toHaveCount(0);
}

test('the Automations page lists your automations then the built-in ones, drafts, edits, resets and deletes automations behind confirmations', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openAutomations(page);
		const cards = page.getByRole('region', { name: 'Your automations' }).getByRole('article');
		await expect(cards).toHaveCount(14);
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
			'Choose a reaction',
			'Suggest automations',
			'Capture to the log',
			'Write the notes',
		].entries()) {
			await expect(cards.nth(index)).toHaveAccessibleName(name);
		}
		await expect(automationCard(page, 'Choose a reaction')).toContainText(
			'When an event no trigger handles',
		);
		await expect(automationCard(page, 'Choose a reaction')).toContainText('Runs on its own');
		await expect(automationCard(page, 'Name chats')).toContainText('When you start a chat');
		await expect(automationCard(page, 'Name chats')).toContainText('Runs on its own');
		await expect(automationCard(page, 'Name chats').getByRole('switch')).toHaveCount(0);

		const nameChats = await openAutomation(page, 'Name chats');
		await expect(nameChats).toContainText(
			'When you start a chat, Name chats runs in the background.',
		);
		await expect(nameChats.getByRole('button', { name: 'Run Name chats' })).toHaveCount(0);
		await expect(nameChats.getByRole('button', { name: 'Delete Name chats' })).toHaveCount(0);
		await expect(nameChats.getByRole('button', { name: 'Reset Name chats' })).toBeVisible();
		await openOverview(page);

		const fixChecks = await openAutomation(page, 'Fix checks');
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
		const draft = page.getByRole('article', { name: 'New automation draft' });
		await expect(draft.getByRole('textbox', { name: 'Step 2' })).toHaveValue(
			'Link every page from the index',
		);
		await draft.getByRole('button', { name: 'Remove step 2' }).click();
		await draft.getByRole('button', { name: 'Remove step 1' }).click();
		await expect(draft.getByRole('button', { name: 'Save automation' })).toBeDisabled();
		await draft.getByRole('button', { name: 'Discard', exact: true }).click();
		await expect(draft).toHaveCount(0);

		await draftAutomation(page, { name: 'Nightly docs', words: 'Tidy the docs' });
		await expect(cards.first()).toHaveAccessibleName('Nightly docs');
		const nightly = await openAutomation(page, 'Nightly docs');
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
					await invoke<{ name: string; runsIn: string }[]>(
						page,
						'automations.list-definitions',
						undefined,
					)
				).find(({ name }) => name === 'Weekly docs'),
			)
			.toMatchObject({ runsIn: 'new-workstream' });
		await expect(weekly).toContainText('runs in a new workstream');
		await captureFlow(app, 'automations-page');

		await weekly.getByRole('button', { name: 'Delete Weekly docs' }).click();
		await weekly.getByRole('button', { name: 'Keep' }).click();
		await expect(weekly.getByRole('button', { name: 'Delete Weekly docs' })).toBeVisible();
		await weekly.getByRole('button', { name: 'Delete Weekly docs' }).click();
		await weekly.getByRole('button', { name: 'Confirm deleting Weekly docs' }).click();
		await expect(weekly).toHaveCount(0);
		await expect(automationCard(page, 'Weekly docs')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a workstream lists only its live automations as lines beside the inspector, a queued line opens its automation to cancel it, a question line opens its chat, and the top bar counts them', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-automations-here',
			WORKSTREAM,
		);
		await openWorkstream(page, seeded.workstreamId);
		const topBarAutomations = page.getByTestId('global-topbar-automations');
		const lines = page.getByRole('list', { name: 'Automations', exact: true });
		await expect(topBarAutomations).toHaveAccessibleName('Automations', { timeout: 20_000 });
		await expect(lines).toHaveCount(0);

		await topBarAutomations.click();
		await expect(page.getByRole('navigation', { name: 'Automations' })).toBeVisible();
		await draftAutomation(page, { name: 'Ask first', words: 'QUESTION before you start' });
		await draftAutomation(page, { name: 'Keep going', words: 'HANG until stopped' });
		await runAutomation(page, 'Ask first');
		await runAutomation(page, 'Keep going');

		await openWorkstream(page, seeded.workstreamId);
		await expect(topBarAutomations).toHaveAccessibleName(/^Automations, .*1 needs you$/u, {
			timeout: 30_000,
		});
		const question = lines.getByRole('link', { name: 'Ask first, Asks you', exact: true });
		await expect(question).toBeVisible({ timeout: 30_000 });
		await expect(lines.getByRole('listitem').first().getByRole('link')).toHaveAccessibleName(
			'Ask first, Asks you',
		);
		await expect(
			page.getByTestId('chat-composer-tray').getByText(/Ask first|Keep going/u),
		).toHaveCount(0);
		await captureFlow(app, 'automations-in-workstream');

		const queued = lines.getByRole('link', { name: 'Keep going, Queued', exact: true });
		await queued.click();
		const recent = page.getByRole('list', { name: 'Recent runs' });
		await recent.getByRole('button', { name: 'Cancel Keep going' }).click();
		const confirm = recent.getByRole('button', { name: 'Confirm cancelling Keep going' });
		await expect(confirm).toHaveText('Cancel automation');
		await confirm.click();
		await expect(recent.getByRole('button', { name: 'Cancel Keep going' })).toHaveCount(0, {
			timeout: 30_000,
		});
		await expect(topBarAutomations).toHaveAccessibleName('Automations, 1 needs you');

		await openWorkstream(page, seeded.workstreamId);
		await expect(queued).toHaveCount(0);
		await question.click();
		await expect(page).toHaveURL(/agent=sess-/u);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
