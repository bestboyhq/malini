import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import {
	CREATED_GITHUB_REPOSITORY_FIXTURE,
	GITHUB_REPOSITORIES_FIXTURE,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	expectPicker,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	type WorkstreamRow,
	withoutConsoleErrors,
} from './harness';

test('a new Mac without Claude Code installs it on its own, holds the first prompt, and says why the install failed', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: { FAKE_BRIDGE_CLAUDE_STATE: 'missing' },
		allowedDiagnostics: [/providers\.install-claude-code ClaudeInstallError/u],
	});
	try {
		const { page } = app;
		await expectPicker(page);
		const failed = page.getByTestId('claude-code-install-status');
		await expect(failed).toHaveRole('alert', { timeout: 20_000 });
		await expect(failed).toContainText(
			'Could not download Claude Code: net::ERR_NAME_NOT_RESOLVED',
		);
		await expect(page.getByTestId('claude-code-setup')).toHaveCount(0);
		await captureFlow(app, 'first-run-claude-install-failed');

		await failed.getByRole('button', { name: 'Try again' }).click();
		await expect(failed).toHaveRole('alert', { timeout: 20_000 });
		await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible();

		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-held-ws', 'Held');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'SEARCH the fixture repo');
		const strip = page.getByTestId('provider-connect-strip');
		await expect(strip).toHaveAttribute('data-access', 'claude-code-missing');
		await expect(strip.getByRole('alert')).toHaveText(
			'Could not download Claude Code: net::ERR_NAME_NOT_RESOLVED',
		);
		const again = strip.getByRole('button', { name: 'Try again' });
		await expect(again).toBeVisible();
		await captureFlow(app, 'composer-claude-install-failed');

		await again.click();
		await expect(strip.getByRole('alert')).toBeVisible({ timeout: 20_000 });
		await expect(again).toBeVisible();
		await expect(strip).toHaveAttribute('data-access', 'claude-code-missing');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a Claude Code check that keeps failing stays on the Repositories page while Malini checks again', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: { FAKE_BRIDGE_STDERR_EXIT: 'claude probe broke' },
		allowedDiagnostics: [/claude probe broke|bridge/iu],
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-probe-ws', 'Probe');
		await page.evaluate(() => {
			location.hash = '#/';
		});
		const setup = page.getByTestId('claude-code-setup');
		await expect(setup).toHaveAttribute('data-claude-code-status', 'unknown', { timeout: 20_000 });
		await page.locator('body').evaluate((body) => {
			const view = body.ownerDocument.defaultView;
			if (!view) return;
			const shown: string[] = [];
			Reflect.set(body, 'claudeSetupShown', shown);
			new view.MutationObserver(() => {
				const panel = body.querySelector('[data-testid="claude-code-setup"]');
				shown.push(panel?.getAttribute('data-claude-code-status') ?? 'hidden');
			}).observe(body, { subtree: true, childList: true, attributes: true });
		});

		await page.waitForTimeout(7_000);

		const shown = await page
			.locator('body')
			.evaluate((body): unknown => Reflect.get(body, 'claudeSetupShown'));
		expect(shown).not.toContain('hidden');
		expect(shown).not.toContain('checking');
		await expect(setup).toContainText('Could not check Claude Code.');
		await captureFlow(app, 'repositories-claude-check-failing');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Check again shows Malini is checking Claude Code until the check answers', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: { FAKE_BRIDGE_STDERR_EXIT: 'claude probe broke' },
		allowedDiagnostics: [/claude probe broke|bridge/iu],
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-check-again-ws', 'Check again');
		await page.evaluate(() => {
			location.hash = '#/';
		});
		const setup = page.getByTestId('claude-code-setup');
		await expect(setup).toHaveAttribute('data-claude-code-status', 'unknown', { timeout: 20_000 });
		const checkAgain = setup.getByRole('button', { name: 'Check Claude Code again' });
		await expect(checkAgain).toBeEnabled();

		await checkAgain.click();
		await expect(checkAgain).toHaveAttribute('aria-busy', 'true');
		await expect(checkAgain).toBeDisabled();
		await captureFlow(app, 'claude-check-again-after');

		await expect(checkAgain).toBeEnabled({ timeout: 20_000 });
		await expect(checkAgain).not.toHaveAttribute('aria-busy', 'true');
		await expect(setup).toContainText('Could not check Claude Code.');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a signed-out Claude Code opens on the picker, and only a Claude send asks to sign in', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_CLAUDE_STATE: 'needs_auth' } });
	try {
		const { page } = app;
		await expectPicker(page);
		await expect(page.getByTestId('claude-code-install-status')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Sign in to Claude Code' })).toHaveCount(0);
		await captureFlow(app, 'first-run-claude-signed-out');

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

test('a new install opens on a picker of your GitHub repositories with no chat, across a reload, and a pick starts a workstream with starters', async () => {
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
		const center = page.getByRole('dialog', { name: 'Command center' });
		await page.reload();
		await expectPicker(page);
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
		expect((await storedSettings(page))['heard-about']).toBeUndefined();
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
		const starters = page.getByRole('region', { name: 'Start with something small' });
		await expect(starters.getByRole('button')).toHaveText([
			/Explain how this repository works/u,
			/Fix the first failing test or lint/u,
		]);
		await captureFlow(app, 'first-repository-picked');
		await starters.getByRole('button', { name: /^Fix the first failing test or lint/u }).click();
		await expect(page.getByTestId('chat-composer-input')).toHaveText(
			'Run the lint and the tests. Fix the first failure you find, and tell me what it was.',
		);
		await expect(prompt).toBeFocused();

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
		await expectPicker(page);
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
		await page.reload();
		await expectPicker(page);
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

test('settings that cannot be read still open the repository picker', async () => {
	test.setTimeout(120_000);
	const unreadable = /no such table: settings/u;
	const app = await launchMalini({ allowedDiagnostics: [unreadable] });
	try {
		const { page } = app;
		await expectPicker(page);
		const settingsTable = (statement: string): void => {
			const db = new DatabaseSync(join(app.userDataDir, 'malini.sqlite'));
			try {
				db.exec(statement);
			} finally {
				db.close();
			}
		};
		settingsTable('ALTER TABLE settings RENAME TO settings_unreadable');
		try {
			await page.reload();
			await expectPicker(page);
		} finally {
			settingsTable('ALTER TABLE settings_unreadable RENAME TO settings');
		}
		withoutConsoleErrors(app, unreadable);
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

async function storedSettings(page: Page): Promise<Record<string, string>> {
	return invoke<Record<string, string>>(page, 'app.list-settings', undefined);
}
