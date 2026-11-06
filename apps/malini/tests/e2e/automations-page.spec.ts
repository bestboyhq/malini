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
} from './harness';

type AutomationRow = Readonly<{
	id: string;
	name: string;
	builtin: string | null;
	instructions: string;
	trigger: Readonly<{ when: string; mode: string }> | null;
	thenAutomationId: string | null;
	boundary: Readonly<{
		event: string;
		before: boolean;
		chats: string;
		attachments: boolean;
		internet: boolean;
	}>;
}>;

async function automations(page: Page): Promise<AutomationRow[]> {
	return invoke<AutomationRow[]>(page, 'automations.list-definitions', undefined);
}

async function automationNamed(page: Page, name: string): Promise<AutomationRow | undefined> {
	return (await automations(page)).find((automation) => automation.name === name);
}

async function builtinId(page: Page, builtin: string): Promise<string> {
	const automation = (await automations(page)).find((candidate) => candidate.builtin === builtin);
	if (!automation) throw new Error(`the built-in ${builtin} automation is missing`);
	return automation.id;
}

test('the Automations page slides the sidebar into its sections and opens the automation its address names as its own page', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openAutomations(page);
		await expect(page).toHaveTitle('Malini · Automations');
		const sections = page.getByRole('navigation', { name: 'Automations' });
		await expect(sections.getByRole('link', { name: 'Overview' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(sections.getByRole('link', { name: /^Routines/u })).toHaveCount(0);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Automations');
		await expect(
			page.getByRole('region', { name: 'Your automations' }).getByRole('article'),
		).toHaveCount(12);

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
		await expect(page).toHaveURL(/#\/automations$/u);
		await expect(page.getByRole('article', { name: 'New automation draft' })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Automation name' })).toHaveValue(
			'Changelog on merge',
		);
		await page.getByRole('button', { name: 'Discard draft' }).click();
		await expect(page.getByRole('article', { name: 'New automation draft' })).toHaveCount(0);

		await page.getByRole('link', { name: 'Set up Update from main' }).click();
		await expect(page).toHaveURL(/#\/automations\/[^/]+$/u);
		await expect(page.getByRole('link', { name: 'Update from main', exact: true })).toHaveAttribute(
			'aria-current',
			'page',
		);
		const detail = page.getByRole('region', { name: 'Update from main', exact: true });
		await expect(detail).toContainText(
			'When main changes a file a workstream changed, Update from main runs in the workstream it fires in.',
		);
		await expect(detail.getByRole('button', { name: /^Then: /u })).toHaveCount(0);
		await expect(detail).toContainText(
			'Resolve conflicts, on its trigger, when the merge stops on conflicts',
		);
		await expect(detail.getByRole('textbox', { name: 'Instructions' })).toHaveCount(0);

		await page.reload();
		await expect(detail).toBeVisible({ timeout: 20_000 });
		await sections.getByRole('link', { name: 'Overview' }).click();
		await expect(detail).toHaveCount(0);
		await expect(page).toHaveURL(/#\/automations$/u);

		await page.getByRole('link', { name: 'Set up Update from main' }).click();
		await sections.getByRole('link', { name: 'Overview' }).click();
		await page.evaluate(() => {
			globalThis.location.hash = '#/automations';
		});
		await page.getByRole('link', { name: 'Set up Merge' }).click();
		const merge = page.getByRole('region', { name: 'Merge', exact: true });
		await expect(merge).toBeVisible();
		await page.waitForTimeout(1_000);
		await expect(merge).toBeVisible();
		await sections.getByRole('link', { name: 'Overview' }).click();
		await expect(merge).toHaveCount(0);

		await openAutomations(page, '#/automations/routines');
		await expect(page).toHaveURL(/#\/automations$/u);
		await expect(page).toHaveTitle('Malini · Automations');

		await page.getByRole('link', { name: 'Workstreams' }).click();
		await expect(sections).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Resolve conflicts runs on its own when a merge stops on conflicts, and its page turns that off and resets it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openAutomations(page);
		await expect(automationCard(page, 'Resolve conflicts')).toContainText(
			'When a merge stops on conflicts',
		);
		const detail = await openAutomation(page, 'Resolve conflicts');
		await expect(
			detail.getByRole('button', {
				name: 'When Resolve conflicts runs: A merge stops on conflicts',
			}),
		).toBeVisible();
		await expect(detail.getByRole('radio', { name: 'On its own' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
		await expect(detail).toContainText(
			'When a merge stops on conflicts, Resolve conflicts runs in the workstream it fires in.',
		);
		await captureFlow(app, 'automations-resolve-conflicts-trigger');

		await detail.getByRole('radio', { name: 'Off' }).click();
		await expect
			.poll(async () => (await automationNamed(page, 'Resolve conflicts'))?.trigger)
			.toEqual({ when: 'on repositories:workstream-merge-conflicted', mode: 'off' });

		await detail.getByRole('button', { name: 'Reset Resolve conflicts' }).click();
		await detail.getByRole('button', { name: 'Confirm resetting Resolve conflicts' }).click();
		await expect
			.poll(async () => (await automationNamed(page, 'Resolve conflicts'))?.trigger)
			.toEqual({ when: 'on repositories:workstream-merge-conflicted', mode: 'auto' });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test("an automation's When, run mode and Then are fields of the automation, and a Then that would loop is refused", async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openAutomations(page);
		await page
			.getByRole('textbox', { name: 'What should happen, and when?' })
			.fill('When a pull request merges, update CHANGELOG.md and open a draft PR');
		await expect(page.getByText('Malini reads')).toBeVisible();
		await page.getByRole('button', { name: /^Draft it/u }).click();
		const draft = page.getByRole('article', { name: 'New automation draft' });
		await expect(draft.getByRole('textbox', { name: 'Step 1' })).toHaveValue('Update CHANGELOG.md');
		await expect(
			draft.getByRole('button', { name: /runs: A pull request merges$/u }),
		).toBeVisible();
		await expect(draft.getByRole('button', { name: 'Then: Open draft' })).toBeVisible();
		await expect(draft.getByRole('radio', { name: 'Ask me first' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
		await captureFlow(app, 'automations-draft');
		await draft.getByRole('button', { name: 'Save automation' }).click();

		const card = automationCard(page, 'Changelog on merge');
		await expect(card).toContainText('When a pull request merges');
		await expect(card).toContainText('Ask me first');
		const openDraft = await builtinId(page, 'open-draft');
		await expect
			.poll(() => automationNamed(page, 'Changelog on merge'))
			.toMatchObject({
				instructions: 'Update CHANGELOG.md',
				trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'ask' },
				thenAutomationId: openDraft,
			});

		await card.getByRole('switch', { name: 'Changelog on merge' }).click();
		await expect(card).toContainText('Off');
		await expect
			.poll(async () => (await automationNamed(page, 'Changelog on merge'))?.trigger?.mode)
			.toBe('off');
		await card.getByRole('switch', { name: 'Changelog on merge' }).click();
		await expect
			.poll(async () => (await automationNamed(page, 'Changelog on merge'))?.trigger?.mode)
			.toBe('ask');

		const detail = await openAutomation(page, 'Changelog on merge');
		await detail.getByRole('radio', { name: 'On its own' }).click();
		await expect
			.poll(async () => (await automationNamed(page, 'Changelog on merge'))?.trigger?.mode)
			.toBe('auto');
		await expect(detail).toContainText(
			'runs in the workstream it fires in and then runs Open draft.',
		);
		await captureFlow(app, 'automations-detail');

		await detail.getByRole('button', { name: 'Then: Open draft' }).click();
		await page.getByRole('menuitemradio', { name: 'Merge' }).click();
		const merge = await builtinId(page, 'merge');
		await expect
			.poll(async () => (await automationNamed(page, 'Changelog on merge'))?.thenAutomationId)
			.toBe(merge);
		await expect(detail).toContainText('and then runs Merge.');

		await detail.getByRole('button', { name: /^When Changelog on merge runs: /u }).click();
		const picker = page.getByRole('dialog', { name: 'When should it run' });
		await picker.getByRole('button', { name: 'Any Malini event…' }).click();
		await picker.getByRole('combobox', { name: 'Event' }).selectOption('chat:session-renamed');
		await picker.getByRole('button', { name: 'Use this event' }).click();
		await expect(picker).toHaveCount(0);
		await expect
			.poll(async () => (await automationNamed(page, 'Changelog on merge'))?.trigger)
			.toEqual({ when: 'on chat:session-renamed', mode: 'auto' });

		await detail.getByRole('button', { name: /^When Changelog on merge runs: /u }).click();
		await picker.getByRole('option', { name: /^When you run it/u }).click();
		await expect(picker).toHaveCount(0);
		await expect
			.poll(async () => (await automationNamed(page, 'Changelog on merge'))?.trigger)
			.toBeNull();
		await expect(
			detail.getByRole('radiogroup', { name: 'How Changelog on merge runs' }),
		).toHaveCount(0);

		await openOverview(page);
		await draftAutomation(page, { name: 'Release notes', words: 'Write the release notes' });
		const changelog = await automationNamed(page, 'Changelog on merge');
		const notes = await automationNamed(page, 'Release notes');
		if (!changelog || !notes) throw new Error('the drafted automations are missing');
		const notesDetail = await openAutomation(page, 'Release notes');
		await notesDetail.getByRole('button', { name: 'Then: Nothing' }).click();
		await page.getByRole('menuitemradio', { name: 'Changelog on merge' }).click();
		await expect
			.poll(async () => (await automationNamed(page, 'Release notes'))?.thenAutomationId)
			.toBe(changelog.id);
		await openOverview(page);

		const loop = await openAutomation(page, 'Changelog on merge');
		await loop.getByRole('button', { name: 'Then: Merge' }).click();
		await page.getByRole('menuitemradio', { name: 'Release notes' }).click();
		await expect(loop.getByRole('alert')).toContainText('loop');
		await expect
			.poll(async () => (await automationNamed(page, 'Changelog on merge'))?.thenAutomationId)
			.toBe(merge);

		await loop.getByRole('button', { name: 'Delete Changelog on merge' }).click();
		await loop.getByRole('button', { name: 'Confirm deleting Changelog on merge' }).click();
		await expect(loop).toHaveCount(0);
		await expect(card).toHaveCount(0);
		await expect
			.poll(async () => (await automationNamed(page, 'Release notes'))?.thenAutomationId)
			.toBeNull();
		await expect(automationCard(page, 'Release notes')).toContainText('Runs when you run it');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an automation sees and reaches only what you set on its page, and says when it can leak your words', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await openAutomations(page);
		await draftAutomation(page, { name: 'Triage', words: 'Triage the failing checks' });
		await expect
			.poll(async () => (await automationNamed(page, 'Triage'))?.boundary)
			.toEqual({
				event: 'facts',
				before: true,
				chats: 'none',
				attachments: false,
				internet: false,
			});

		const detail = await openAutomation(page, 'Triage');
		const sees = detail.getByRole('region', { name: 'What it sees' });
		const reaches = detail.getByRole('region', { name: 'What it reaches' });
		const nav = page.getByRole('complementary');
		const leak = detail.getByRole('alert');
		await expect(sees.getByRole('switch', { name: 'Code and changes' })).toBeDisabled();
		await expect(sees.getByRole('switch', { name: 'The automation before it' })).toBeDisabled();
		await expect(sees).toContainText('It never sees your words.');
		await expect(leak).toHaveCount(0);

		await reaches.getByRole('switch', { name: 'The internet' }).click();
		await expect
			.poll(async () => (await automationNamed(page, 'Triage'))?.boundary.internet)
			.toBe(true);
		await sees
			.getByRole('radiogroup', { name: 'Your chats' })
			.getByRole('radio', { name: 'Every chat' })
			.click();
		await expect(
			leak.getByRole('heading', { name: 'This automation can leak your words' }),
		).toBeVisible();
		await expect(leak).toContainText(
			'It sees every chat in Malini. It can reach any site on the internet.',
		);
		await expect(nav.getByRole('link', { name: /^Triage/u })).toContainText('Can leak');
		await expect
			.poll(async () => (await automationNamed(page, 'Triage'))?.boundary.chats)
			.toBe('all');
		await captureFlow(app, 'automations-boundary-can-leak');

		await leak.getByRole('button', { name: 'Turn off the internet' }).click();
		await expect(leak).toHaveCount(0);
		await expect(sees).toContainText(
			'It sees your words, and nothing it does leaves your Mac except through Claude.',
		);
		await expect(reaches.getByRole('switch', { name: 'The internet' })).not.toBeChecked();
		await expect(reaches).not.toContainText('GitHub');
		await expect(nav.getByRole('link', { name: /^Triage/u })).not.toContainText('Can leak');

		await detail.getByRole('button', { name: 'Then: Nothing' }).click();
		await page.getByRole('menuitemradio', { name: 'Open draft' }).click();
		await expect(leak).toContainText('Open draft publishes what it writes to GitHub.');
		await expect(reaches).toContainText('Through Then');

		await leak.getByRole('button', { name: 'Stop it seeing your words' }).click();
		await expect(leak).toHaveCount(0);
		await expect(sees).toContainText('It never sees your words.');
		await expect
			.poll(async () => (await automationNamed(page, 'Triage'))?.boundary)
			.toEqual({
				event: 'facts',
				before: false,
				chats: 'none',
				attachments: false,
				internet: false,
			});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an automation runs on a schedule, in its own chat at Home or in the repository you pick', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		await invoke(page, 'repositories.create-repository', { repoUrl: `file://${api}` });
		await openAutomations(page);
		await page
			.getByRole('textbox', { name: 'What should happen, and when?' })
			.fill('Every weekday at 9:00, triage new issues');
		await expect(page.getByText('Every weekday at 9:00', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: /^Draft it/u }).click();
		const draft = page.getByRole('article', { name: 'New automation draft' });
		await expect(
			draft.getByRole('button', { name: /runs: Every weekday at 9:00$/u }),
		).toBeVisible();
		await expect(draft.getByRole('button', { name: 'Runs in: Home' })).toBeVisible();
		await draft.getByRole('button', { name: 'Save automation' }).click();
		await expect
			.poll(() => automationNamed(page, 'Triage new issues'))
			.toMatchObject({ trigger: { when: 'every weekday at 09:00', mode: 'ask' } });

		const detail = await openAutomation(page, 'Triage new issues');
		await expect(detail).toContainText(
			'Every weekday at 9:00, Triage new issues runs in its own chat at Home. It asks you first.',
		);
		await detail.getByRole('button', { name: /^When Triage new issues runs: /u }).click();
		const picker = page.getByRole('dialog', { name: 'When should it run' });
		await picker.getByRole('option', { name: /^Every weekday at 9:00/u }).click();
		await picker.getByRole('combobox', { name: 'Repeat' }).selectOption('monday');
		await picker.getByLabel('At', { exact: true }).fill('07:30');
		await expect(picker.getByText('every monday at 07:30', { exact: true })).toBeVisible();
		await captureFlow(app, 'automations-schedule');
		await picker.getByRole('button', { name: 'Use this schedule' }).click();
		await expect(picker).toHaveCount(0);
		await expect
			.poll(async () => (await automationNamed(page, 'Triage new issues'))?.trigger?.when)
			.toBe('every monday at 07:30');

		await detail.getByRole('button', { name: 'Runs in: Home' }).click();
		await page.getByRole('menuitemradio', { name: 'acme/api' }).click();
		await expect
			.poll(async () => (await automationNamed(page, 'Triage new issues'))?.trigger?.when)
			.toBe('every monday at 07:30 in acme/api');
		await expect(detail).toContainText(
			'Every Monday at 7:30, Triage new issues runs in its own workstream of acme/api.',
		);
		await captureFlow(app, 'automations-schedule-detail');

		await openOverview(page);
		const merge = await openAutomation(page, 'Merge');
		await merge.getByRole('button', { name: /^When Merge runs: /u }).click();
		await expect(picker.getByRole('option', { name: /^On a schedule/u })).toHaveCount(0);
		await page.keyboard.press('Escape');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
