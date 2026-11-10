import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CLAUDE_INSTALL_COMMAND } from '../../src/contract/agent';
import type { BrainStatus } from '../../src/contract/brain';
import { brainOnGithub, FAKE_BRAIN } from './fake-brain';
import {
	CREATED_GITHUB_REPOSITORY_FIXTURE,
	GITHUB_REPOSITORIES_FIXTURE,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	passDefaults,
	passSidebar,
	passSetup,
	seedWorkstream,
	sendPrompt,
	type WorkstreamRow,
} from './harness';

test('a new Mac without Claude Code cannot pass setup, installs it in place, and says why an install failed', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: { FAKE_BRIDGE_CLAUDE_STATE: 'missing' },
		allowedDiagnostics: [/providers\.install-claude-code ClaudeInstallError/u],
	});
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		await expect(
			setup.getByRole('heading', { name: 'Connect Claude Code and GitHub' }),
		).toBeVisible();
		await expect(
			setup.getByRole('list', { name: 'Setup progress' }).getByRole('listitem'),
		).toHaveCount(5);
		const claude = setup.getByTestId('claude-code-setup');
		await expect(claude).toHaveAttribute('data-claude-code-status', 'missing', { timeout: 20_000 });
		await expect(claude.getByRole('status')).toHaveText('Not installed on this Mac yet.');
		await expect(setup.getByRole('button', { name: 'Continue' })).toBeDisabled();
		await expect(setup.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
		await expect(claude.getByText(CLAUDE_INSTALL_COMMAND)).toHaveCount(0);
		await captureFlow(app, 'first-run-install-claude');

		await claude.getByRole('button', { name: 'Install Claude Code' }).click();

		await expect(
			claude.getByRole('button', { name: 'Try installing Claude Code again' }),
		).toBeVisible({ timeout: 20_000 });
		await expect(claude.getByRole('status')).toHaveText(
			'Could not download Claude Code: net::ERR_NAME_NOT_RESOLVED',
		);
		await expect(claude.getByText(CLAUDE_INSTALL_COMMAND)).toBeVisible();
		await expect(setup.getByRole('button', { name: 'Continue' })).toBeDisabled();
		await expect(setup.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
		await captureFlow(app, 'first-run-install-claude-failed');
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
		const tools = setup.getByRole('list', { name: 'Tools' });
		await expect(tools).toContainText('Installed on this Mac', { timeout: 20_000 });
		await expect(tools.getByRole('button', { name: /^Claude Code/u })).toHaveCount(0);
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
		await page.getByRole('option', { name: /^Opus 5\.5/u }).hover();
		await expect(
			page.locator('[data-testid="chat-model-runner"][data-provider="claude"]'),
		).toContainText('Needs a sign-in');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('listbox', { name: 'Models' })).toBeHidden();
		await expect(page.getByTestId('chat-model-runners')).toHaveCount(0);
		await sendPrompt(page, 'SEARCH the fixture repo');
		const connect = page.getByTestId('provider-connect-strip');
		await expect(connect).toHaveAttribute('data-access', 'claude-signed-out');
		await expect(connect).toContainText('Sign in to Claude Code to run this');
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

		const sidebarStep = setup.getByRole('heading', { name: 'Set up your sidebar' });
		await expect(sidebarStep).toBeVisible();
		const copiedBefore = (await rehearsalCopies()).length;
		await expect.poll(async () => (await rehearsalCopies()).length).toBeGreaterThan(copiedBefore);
		await expect.poll(copiesOnStage, { timeout: 20_000 }).toBe(0);
		await expect(sidebarStep).toHaveCount(1);
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
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await next.click();
		await passSidebar(page);
		await passDefaults(page);
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
		await expect(setup.getByRole('heading', { name: 'Pick your defaults' })).toBeVisible();
		await next.click();
		await expect(where).toHaveValue('@syntaxfm podcast');

		await next.click();
		await expect(page.getByTestId('first-repository-picker')).toBeVisible({ timeout: 20_000 });
		await expect
			.poll(async () => (await storedSettings(page))['heard-about'])
			.toBe('syntaxfm podcast');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Recommended defaults turn on every default automation and set up a private brain on GitHub', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await brainOnGithub(app, 'missing');
		const setup = page.getByTestId('onboarding');
		const next = setup.getByRole('button', { name: 'Continue' });
		await next.click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await next.click();
		await passSidebar(page);
		await expect(setup.getByRole('heading', { name: 'Pick your defaults' })).toBeVisible();
		await expect(setup.getByText('Step 4 of 5')).toBeVisible();
		const recommended = setup.getByRole('radio', { name: /^Recommended/u });
		await expect(recommended).toHaveAttribute('aria-checked', 'true');
		await expect(
			setup.getByRole('list', { name: 'Recommended defaults' }).getByRole('listitem'),
		).toHaveText([
			/Resolve merge conflicts/u,
			/Address review comments/u,
			/Keep a second brain/u,
			/Update from main when it touches your files/u,
		]);
		await expect(next).toBeEnabled();
		await captureFlow(app, 'setup-defaults');

		await setup.getByRole('radio', { name: /^Customize/u }).click();
		await expect(setup.getByRole('checkbox', { name: /^Keep a second brain/u })).toBeChecked();
		await expect(
			setup.getByRole('group', { name: 'Update from main' }).getByRole('button', {
				name: 'Touches my files',
			}),
		).toHaveAttribute('aria-pressed', 'true');
		await captureFlow(app, 'setup-defaults-customize');
		await recommended.click();
		await next.click();
		await expect(
			setup.getByRole('heading', { name: 'Where did you hear about Malini?' }),
		).toBeVisible();

		await expect
			.poll(async () => triggers(page), { timeout: 60_000 })
			.toEqual({
				'resolve-conflicts': 'auto',
				'address-review': 'auto',
				'update-from-main':
					'auto on repositories:workstream-base-overlapped where overlapping is true',
				'capture-brain': 'auto',
				'write-brain-notes': 'auto',
			});
		expect(await invoke<BrainStatus>(page, 'brain.status', undefined)).toMatchObject({
			set: true,
			repository: FAKE_BRAIN,
			sync: true,
		});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Customize with Address review unchecked turns it off, and it stays off across a reload', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		const next = setup.getByRole('button', { name: 'Continue' });
		await next.click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await next.click();
		await passSidebar(page);
		await setup.getByRole('radio', { name: /^Customize/u }).click();
		await setup.getByRole('checkbox', { name: /^Address review comments/u }).uncheck();
		await setup.getByRole('checkbox', { name: /^Keep a second brain/u }).uncheck();
		await expect(setup.getByText(/^The log holds/u)).toHaveCount(0);
		await next.click();
		await expect(
			setup.getByRole('heading', { name: 'Where did you hear about Malini?' }),
		).toBeVisible();
		await expect
			.poll(async () => triggers(page))
			.toMatchObject({ 'resolve-conflicts': 'auto', 'address-review': 'off' });

		await page.reload();
		await expect
			.poll(async () => triggers(page), { timeout: 20_000 })
			.toEqual({
				'resolve-conflicts': 'auto',
				'address-review': 'off',
				'update-from-main':
					'auto on repositories:workstream-base-overlapped where overlapping is true',
				'capture-brain': 'off',
				'write-brain-notes': 'off',
			});
		await page.evaluate(() => {
			location.hash = '#/settings/automations';
		});
		await page.reload();
		await expect(page.getByRole('switch', { name: 'Address review comments' })).toHaveAttribute(
			'aria-checked',
			'false',
			{ timeout: 20_000 },
		);
		await expect(
			page.getByRole('group', { name: 'Defaults' }).getByRole('button', { name: 'Custom' }),
		).toHaveAttribute('aria-pressed', 'true');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('setup ends on a picker of your GitHub repositories with no chat, across a reload, and a pick starts a workstream in it', async () => {
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
		await passSidebar(page);
		await passDefaults(page);
		await setup
			.getByRole('group', { name: 'Where you heard about Malini' })
			.getByRole('button', { name: 'Hacker News' })
			.click();
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();

		const chooser = page.getByRole('region', { name: 'Your repositories' });
		const repositories = chooser.getByRole('list', { name: 'Your GitHub repositories' });
		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const tabs = page.getByRole('tablist', { name: 'Chats and files' });
		const prompt = page.getByRole('textbox', { name: 'Chat prompt' });
		await expect(repositories.getByRole('button')).toHaveCount(2, { timeout: 20_000 });
		await expect(repositories.getByRole('button', { name: 'e2e/hutch' })).toContainText('2h ago');
		await expect(repositories.getByRole('img', { name: 'Private' })).toHaveCount(1);
		await expect(chooser.getByRole('button', { name: 'Open a folder' })).toBeVisible();
		await expect(chooser.getByRole('button', { name: 'New repository' })).toBeVisible();
		await expect(sidebar).toHaveCount(0);
		await expect(tabs).toHaveCount(0);
		await expect(prompt).toHaveCount(0);
		await expect.poll(async () => (await storedSettings(page))['heard-about']).toBe('');
		expect(await workstreams(page)).toEqual([]);
		await captureFlow(app, 'first-repository-picker');

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
		await page.keyboard.press('ControlOrMeta+k');
		await expect(center.getByRole('combobox', { name: 'Command or repository' })).toBeFocused();
		await page.keyboard.press('ControlOrMeta+k');
		await expect(center).toHaveCount(0);

		await repositories.getByRole('button', { name: 'e2e/hutch' }).click();
		await expect(page).toHaveURL(/#\/workstreams\//u, { timeout: 30_000 });
		await expect(sidebar.getByTestId('sidebar-workstream')).toHaveAttribute('aria-current', 'page');
		await expect(
			sidebar.getByTestId('sidebar-connected-repository').filter({ hasText: 'hutch' }),
		).toBeVisible();
		await expect(
			page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]'),
		).toBeVisible({ timeout: 30_000 });
		await expect(chooser).toHaveCount(0);
		await expect(tabs).toBeVisible();
		await expect
			.poll(async () => (await workstreams(page)).map(({ projectId }) => projectId))
			.toEqual([expect.stringContaining('hutch')]);
		await captureFlow(app, 'first-repository-picked');

		await page.reload();
		await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 20_000 });
		await expect(chooser).toHaveCount(0);
		await page.evaluate(() => (globalThis.location.hash = '#/'));
		await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();
		await expect(page.getByTestId('repository-row').filter({ hasText: 'hutch' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('New repository on the first-run picker makes one on GitHub under the owner you pick and starts a workstream in it, and says why when GitHub refuses', async () => {
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
		await expect(page).toHaveURL(/#\/workstreams\//u, { timeout: 30_000 });
		await expect(
			page
				.getByRole('navigation', { name: 'Connected repositories' })
				.getByTestId('sidebar-connected-repository')
				.filter({ hasText: 'rabbit-den' }),
		).toBeVisible();
		await expect(chooser).toHaveCount(0);
		await expect
			.poll(async () => (await workstreams(page)).map(({ projectId }) => projectId))
			.toEqual([expect.stringContaining('rabbit-den')]);
		await captureFlow(app, 'first-repository-new-repository');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('quitting while the first pick clones reopens on Repositories with the repository, not on a blank workstream', async () => {
	test.setTimeout(180_000);
	const first = await launchMalini();
	try {
		const { page } = first;
		const hutch = await createSourceRepo(first.root, 'e2e/hutch');
		writeFileSync(
			join(first.home, GITHUB_REPOSITORIES_FIXTURE),
			JSON.stringify([{ full_name: 'e2e/hutch', clone_url: `file://${hutch}`, description: null }]),
		);
		await passSetup(page);
		slowClone(join(first.home, '.local/bin'));
		await page
			.getByRole('list', { name: 'Your GitHub repositories', exact: true })
			.getByRole('button', { name: 'e2e/hutch' })
			.click();
		await expect(page).toHaveURL(/#\/workstreams\//u);
		expect(await workstreams(page)).toEqual([]);
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(page).toHaveURL(/#\/$/u);
		await expect(page.getByTestId('repository-row').filter({ hasText: 'hutch' })).toBeVisible();
		expect(await workstreams(page)).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

function slowClone(binFolder: string): void {
	const git = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
	const stub = join(binFolder, 'git');
	writeFileSync(
		stub,
		`#!/bin/sh\ncase " $* " in *" clone "*) sleep 6 ;; esac\nexec "${git}" "$@"\n`,
	);
	chmodSync(stub, 0o755);
}

async function workstreams(page: Page): Promise<WorkstreamRow[]> {
	return invoke<WorkstreamRow[]>(page, 'repositories.list-workstreams', undefined);
}

async function triggers(page: Page): Promise<Record<string, string>> {
	const definitions = await invoke<
		{ builtin: string | null; trigger: { when: string; mode: string } | null }[]
	>(page, 'automations.list-definitions', undefined);
	return Object.fromEntries(
		definitions
			.filter(({ builtin }) =>
				[
					'resolve-conflicts',
					'address-review',
					'update-from-main',
					'capture-brain',
					'write-brain-notes',
				].includes(builtin ?? ''),
			)
			.map(({ builtin, trigger }) => [
				builtin,
				builtin === 'update-from-main' && trigger
					? `${trigger.mode} ${trigger.when}`
					: (trigger?.mode ?? 'off'),
			]),
	);
}

async function storedSettings(page: Page): Promise<Record<string, string>> {
	return invoke<Record<string, string>>(page, 'app.list-settings', undefined);
}
