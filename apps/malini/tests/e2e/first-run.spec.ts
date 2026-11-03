import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	CREATED_GITHUB_REPOSITORY_FIXTURE,
	GITHUB_REPOSITORIES_FIXTURE,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	passSetup,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('a new Mac without Claude Code is walked to install it, with the command it will run', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_CLAUDE_STATE: 'missing' } });
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		await expect(
			setup.getByRole('heading', { name: 'Connect Claude Code and GitHub' }),
		).toBeVisible();
		await expect(
			setup.getByRole('list', { name: 'Setup progress' }).getByRole('listitem'),
		).toHaveCount(3);
		const claude = setup.getByTestId('claude-code-setup');
		await expect(claude).toHaveAttribute('data-claude-code-status', 'missing', { timeout: 20_000 });
		await expect(
			claude.getByRole('button', { name: 'Install Claude Code in Terminal' }),
		).toBeVisible();
		await expect(claude.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeVisible();
		await captureFlow(app, 'first-run-install-claude');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a signed-out Claude Code passes setup, and only a Claude send asks to sign in', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_CLAUDE_STATE: 'needs_auth' } });
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		const accounts = setup.getByRole('list', { name: 'Accounts' });
		await expect(accounts).toContainText('Installed on this Mac', { timeout: 20_000 });
		await expect(accounts.getByRole('button', { name: /^Claude Code/u })).toHaveCount(0);
		await expect(setup.getByRole('button', { name: 'Sign in to Claude Code' })).toHaveCount(0);
		const proceed = setup.getByTestId('onboarding-continue');
		await expect(proceed).toBeEnabled();
		await captureFlow(app, 'first-run-claude-installed');
		await proceed.click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();

		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-sign-in-ws', 'Sign in');
		await page.evaluate(() => {
			location.hash = '#/';
		});
		await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();
		await expect(page.getByTestId('repository-row').first()).toBeVisible();
		await expect(page.getByTestId('claude-code-setup')).toHaveCount(0);

		await openWorkstream(page, workstreamId);
		const picker = page.getByRole('button', { name: 'Model: Opus' });
		await expect(picker).toBeVisible({ timeout: 20_000 });
		await picker.click();
		await expect(page.getByRole('listbox', { name: 'Models' })).toBeVisible();
		await expect(
			page.locator(
				'[data-testid="chat-model-option"][data-provider="claude"] [data-testid="chat-model-no-access"]',
			),
		).toHaveCount(2);
		await page.keyboard.press('Escape');
		await sendPrompt(page, 'SEARCH the fixture repo');
		const connect = page.getByTestId('provider-connect-card');
		await expect(connect).toHaveAttribute('data-access', 'claude-signed-out');
		await expect(connect).toContainText('Sign in to Claude Code to run this message.');
		await expect(connect.getByRole('button', { name: 'Sign in with Claude' })).toBeVisible();
		await expect(page.getByTestId('chat-prompt-pick')).toHaveCount(0);
		await captureFlow(app, 'composer-sign-in-claude');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

type RehearsalCopy = { hidden: string | null; inert: boolean; named: number };

const REHEARSAL_COPY = ':has(> * > #onboarding-heading) > :not(:has(#onboarding-heading))';

test('onboarding rehearses its step transition on copies nobody can reach, and drops them on a step change', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		const copiesOnStage = (): Promise<number> =>
			setup.evaluate(
				(onboarding, copySelector) => onboarding.querySelectorAll(copySelector).length,
				REHEARSAL_COPY,
			);
		await expect(
			setup.getByRole('heading', { name: 'Connect Claude Code and GitHub' }),
		).toBeVisible();
		await setup.evaluate((onboarding, copySelector) => {
			const view = onboarding.ownerDocument.defaultView;
			const copies: RehearsalCopy[] = [];
			const seen = new WeakSet();
			new view.MutationObserver(() => {
				for (const copy of onboarding.querySelectorAll(copySelector)) {
					if (seen.has(copy)) continue;
					seen.add(copy);
					copies.push({
						hidden: copy.getAttribute('aria-hidden'),
						inert: copy.hasAttribute('inert'),
						named: copy.querySelectorAll('[id], [data-testid]').length,
					});
				}
			}).observe(onboarding, { childList: true, subtree: true });
			Reflect.set(view, 'rehearsalCopies', copies);
			view.dispatchEvent(new view.FocusEvent('focus'));
		}, REHEARSAL_COPY);
		const rehearsalCopies = (): Promise<RehearsalCopy[]> =>
			page.evaluate(() => Reflect.get(globalThis, 'rehearsalCopies'));

		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await setup.evaluate(
			(onboarding, copySelector) =>
				new Promise<void>((resolve) => {
					const look = (): void => {
						if (onboarding.querySelector(copySelector)) resolve();
						else onboarding.ownerDocument.defaultView.requestAnimationFrame(look);
					};
					look();
				}),
			REHEARSAL_COPY,
		);
		const continueOnCopies = await setup
			.getByRole('button', { name: 'Continue' })
			.evaluate((button, copySelector) => {
				const onboarding = button.closest('[data-testid="onboarding"]');
				const before = onboarding.querySelectorAll(copySelector).length;
				button.click();
				return { before, after: onboarding.querySelectorAll(copySelector).length };
			}, REHEARSAL_COPY);
		expect(continueOnCopies.before).toBeGreaterThan(0);
		expect(continueOnCopies.after).toBe(0);

		const heardAbout = setup.getByRole('heading', { name: 'Where did you hear about Malini?' });
		await expect(heardAbout).toBeVisible();
		const copiedBefore = (await rehearsalCopies()).length;
		await expect.poll(async () => (await rehearsalCopies()).length).toBeGreaterThan(copiedBefore);
		await expect.poll(copiesOnStage, { timeout: 20_000 }).toBe(0);
		await expect(heardAbout).toHaveCount(1);
		await expect(page.locator('#onboarding-heading')).toHaveCount(1);

		const copies = await rehearsalCopies();
		expect(copies).toEqual(copies.map(() => ({ hidden: 'true', inert: true, named: 0 })));
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('setup asks where you heard about Malini last, keeps your answer while you go back, and opens a chat with it saved', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		const next = setup.getByRole('button', { name: 'Continue' });
		await next.click();
		const sounds = setup.getByRole('heading', { name: 'Hear your afternoon' });
		await expect(sounds).toBeVisible();
		await next.click();
		await expect(
			setup.getByRole('heading', { name: 'Where did you hear about Malini?' }),
		).toBeVisible();
		await expect(next).toBeDisabled();

		const channels = setup.getByRole('group', { name: 'Where you heard about Malini' });
		const hackerNews = channels.getByRole('button', { name: 'Hacker News' });
		await hackerNews.click();
		await expect(hackerNews).toHaveAttribute('aria-pressed', 'true');
		await expect(next).toBeEnabled();
		await captureFlow(app, 'setup-heard-about-hacker-news');

		await channels.getByRole('button', { name: 'Somewhere else' }).click();
		await expect(hackerNews).toHaveAttribute('aria-pressed', 'false');
		const where = setup.getByRole('textbox', { name: 'Where you heard about Malini' });
		await expect(where).toBeFocused();
		await where.fill('@syntaxfm podcast');
		await captureFlow(app, 'setup-heard-about-somewhere-else');
		await setup.getByRole('button', { name: 'Back' }).click();
		await expect(sounds).toBeVisible();
		await next.click();
		await expect(where).toHaveValue('@syntaxfm podcast');

		await next.click();
		await expect(page.getByTestId('first-chat-repositories')).toBeVisible({ timeout: 20_000 });
		await expect
			.poll(async () => (await storedSettings(page))['heard-about'])
			.toBe('syntaxfm podcast');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('setup ends in a chat at Home that lists your GitHub repositories and nothing else, across a reload, and a pick clones it while you stay in the chat until you send', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const hutch = await createSourceRepo(app.root, 'e2e/hutch');
		writeFileSync(
			join(app.home, GITHUB_REPOSITORIES_FIXTURE),
			JSON.stringify([
				{
					full_name: 'e2e/hutch',
					clone_url: `file://${hutch}`,
					description: null,
					private: true,
					pushed_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
				},
				{
					full_name: 'e2e/burrow',
					clone_url: 'https://github.com/e2e/burrow.git',
					description: 'Where the rabbits live.',
					private: false,
					pushed_at: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
				},
			]),
		);
		const setup = page.getByTestId('onboarding');
		const center = page.getByRole('dialog', { name: 'Command center' });
		await expect(setup).toBeVisible();
		await page.keyboard.press('ControlOrMeta+k');
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await expect(center).toHaveCount(0);
		await setup.getByRole('button', { name: 'Continue' }).click();
		await setup
			.getByRole('group', { name: 'Where you heard about Malini' })
			.getByRole('button', { name: 'Hacker News' })
			.click();
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();

		const chooser = page.getByRole('region', { name: 'Your repositories' });
		const repositories = chooser.getByRole('list', { name: 'Your GitHub repositories' });
		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const tabs = page.getByRole('tablist', { name: 'Chats and files' });
		await expect(repositories.getByRole('button')).toHaveCount(2, { timeout: 20_000 });
		await expect(repositories.getByRole('button', { name: 'e2e/hutch' })).toContainText('2h ago');
		await expect(repositories.getByRole('img', { name: 'Private' })).toHaveCount(1);
		await expect(chooser.getByRole('button', { name: 'New repository' })).toBeVisible();
		await expect(sidebar).toHaveCount(0);
		await expect(tabs).toHaveCount(0);
		await expect.poll(async () => (await storedSettings(page))['heard-about']).toBe('');
		await expect
			.poll(async () =>
				(
					await invoke<{ scope: string | null }[]>(page, 'repositories.list-workstreams', undefined)
				).map((workstream) => workstream.scope),
			)
			.toEqual(['home']);
		await captureFlow(app, 'first-chat');

		await chooser.getByRole('button', { name: 'More repositories' }).click();
		const search = center.getByRole('combobox', { name: 'Search repositories' });
		const found = center.getByRole('listbox', { name: 'Your repositories' });
		await expect(search).toBeFocused();
		await expect(found.getByRole('option')).toHaveCount(2);
		await search.fill('rabbits');
		await expect(found.getByRole('option')).toHaveCount(1);
		await expect(found.getByRole('option', { name: /e2e\/burrow/u })).toBeVisible();
		await search.fill('warren');
		await expect(found.getByRole('option')).toHaveCount(1);
		await expect(found.getByRole('option', { name: /^New repository “warren”/u })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(center).toHaveCount(0);

		await page.reload();
		await expect(repositories.getByRole('button')).toHaveCount(2, { timeout: 20_000 });
		await expect(sidebar).toHaveCount(0);
		await page.getByRole('textbox', { name: 'Chat prompt' }).click();
		await page.keyboard.press('ControlOrMeta+k');
		await expect(center.getByRole('combobox', { name: 'Command or repository' })).toBeFocused();
		await page.keyboard.press('ControlOrMeta+k');
		await expect(center).toHaveCount(0);

		const pick = repositories.getByRole('button', { name: 'e2e/hutch' });
		await pick.click();
		await expect(
			sidebar.getByTestId('sidebar-connected-repository').filter({ hasText: 'hutch' }),
		).toBeVisible({ timeout: 30_000 });
		await expect(pick).toBeDisabled();
		await expect(pick).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 });
		await expect(chooser).toBeVisible();
		await expect(tabs).toHaveCount(0);
		await captureFlow(app, 'first-chat-picked');

		await page.reload();
		await expect(sidebar).toBeVisible({ timeout: 20_000 });
		await expect(pick).toBeDisabled();

		await sendPrompt(page, 'Tidy up the hutch');
		await expect(chooser).toHaveCount(0, { timeout: 20_000 });
		await expect(tabs).toBeVisible();
		await expect(page.getByTestId('lead-timeline').getByText('Tidy up the hutch')).toBeVisible();
		await page.reload();
		await expect(sidebar).toBeVisible({ timeout: 20_000 });
		await expect(chooser).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('New repository under the first chat makes one on GitHub under the owner you pick and clones it, and says why when GitHub refuses', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		allowedDiagnostics: [/repositories\.create-github-repository/u],
	});
	try {
		const { page } = app;
		await passSetup(page);
		const chooser = page.getByRole('region', { name: 'Your repositories' });
		await chooser.getByRole('button', { name: 'New repository' }).click();

		const dialog = page.getByRole('dialog', { name: 'Command center' });
		const name = dialog.getByRole('textbox', { name: 'Repository name' });
		const owner = dialog.getByRole('combobox', { name: 'Owner' });
		await expect(name).toBeFocused();
		await expect(owner).toHaveValue('e2e-user');
		await expect(owner.getByRole('option')).toHaveText(['e2e-user', 'e2e-org']);
		await expect(dialog.getByRole('checkbox', { name: 'Private' })).toBeChecked();
		await name.press('Enter');
		await expect(dialog.getByRole('alert')).toHaveCount(0);
		await owner.selectOption('e2e-org');
		await name.fill('rabbit den');
		await expect(dialog).toContainText('/ rabbit-den');

		await name.press('Enter');
		const failure = dialog.getByRole('alert');
		await expect(failure).toContainText('Could not create repository', { timeout: 20_000 });
		await expect(failure).toContainText('Name already exists on this account');
		await expect(name).toHaveValue('rabbit den');

		const den = await createSourceRepo(app.root, 'e2e-org/rabbit-den');
		writeFileSync(
			join(app.home, CREATED_GITHUB_REPOSITORY_FIXTURE),
			JSON.stringify({
				full_name: 'e2e-org/rabbit-den',
				clone_url: `file://${den}`,
				description: null,
				private: true,
				pushed_at: new Date().toISOString(),
			}),
		);
		await name.press('Enter');
		await expect(dialog).toHaveCount(0, { timeout: 30_000 });
		await expect(
			page
				.getByRole('navigation', { name: 'Connected repositories' })
				.getByTestId('sidebar-connected-repository')
				.filter({ hasText: 'rabbit-den' }),
		).toBeVisible();
		await expect(
			chooser
				.getByRole('list', { name: 'Your GitHub repositories' })
				.getByRole('button', { name: 'e2e-org/rabbit-den' }),
		).toBeDisabled();
		await captureFlow(app, 'first-chat-new-repository');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function storedSettings(page: Page): Promise<Record<string, string>> {
	return invoke<Record<string, string>>(page, 'app.list-settings', undefined);
}
