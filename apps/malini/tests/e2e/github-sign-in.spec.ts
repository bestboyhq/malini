import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	GITHUB_DEVICE_APPROVED,
	GITHUB_REPOSITORIES_FIXTURE,
	captureFlow,
	connectFolder,
	expectCleanConsole,
	expectPicker,
	launchMalini,
	recordBrowserAndClipboard,
	recordedBrowserAndClipboard,
} from './harness';

test('the picker signs in to GitHub with a one-time code, without a terminal, then lists your repositories', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { E2E_GITHUB_SIGNED_OUT: '1' } });
	try {
		const { page } = app;
		await recordBrowserAndClipboard(app);
		writeFileSync(
			join(app.home, GITHUB_REPOSITORIES_FIXTURE),
			JSON.stringify([
				{
					full_name: 'e2e/hutch',
					clone_url: 'https://github.com/e2e/hutch.git',
					description: null,
				},
			]),
		);
		await expectPicker(page);
		const chooser = page.getByRole('region', { name: 'Your repositories' });
		const github = chooser.getByTestId('github-setup');
		await expect(github).toHaveAttribute('data-github-status', 'signed-out', { timeout: 20_000 });
		await expect(
			github.getByRole('heading', { name: 'Sign in to GitHub to list your repositories' }),
		).toBeVisible();
		await expect(github.getByRole('status')).toHaveText(
			'Malini clones its own copy. Your checkouts stay as they are.',
		);
		await expect(chooser.getByRole('button', { name: 'Open a folder' })).toBeVisible();
		await expect(chooser.getByRole('list', { name: 'Your GitHub repositories' })).toHaveCount(0);
		await captureFlow(app, 'github-sign-in-signed-out');

		await github.getByRole('button', { name: 'Sign in to GitHub' }).click();

		await expect(github.getByLabel('One-time code')).toHaveText('E2E0-C0DE');
		await expect
			.poll(() => recordedBrowserAndClipboard(app))
			.toEqual({ opened: ['https://github.com/login/device'], copied: ['E2E0-C0DE'] });
		await captureFlow(app, 'github-sign-in-code');

		writeFileSync(join(app.home, GITHUB_DEVICE_APPROVED), '');

		await expect(
			chooser
				.getByRole('list', { name: 'Your GitHub repositories' })
				.getByRole('button', { name: 'e2e/hutch' }),
		).toBeVisible({ timeout: 20_000 });
		await expect(chooser.getByTestId('github-setup')).toHaveCount(0);
		await captureFlow(app, 'github-sign-in-ready');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a missing GitHub CLI and Claude Code install on their own at launch, and each says why it failed', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: { MALINI_GH_PATH: '/usr/bin:/bin', FAKE_BRIDGE_CLAUDE_STATE: 'missing' },
		allowedDiagnostics: [
			/repositories\.install-github-cli GhInstallError/u,
			/providers\.install-claude-code ClaudeInstallError/u,
		],
	});
	try {
		const { page } = app;
		await expectPicker(page);
		const github = page.getByTestId('github-setup');
		const claude = page.getByTestId('claude-code-install-status');
		await expect(github).toHaveAttribute('data-github-status', 'missing', { timeout: 20_000 });
		const githubAgain = github.getByRole('button', { name: 'Try installing the GitHub CLI again' });
		await expect(githubAgain).toBeVisible({ timeout: 20_000 });
		await expect(github.getByRole('status')).toContainText('Could not download the GitHub CLI');
		await expect(claude).toHaveRole('alert', { timeout: 20_000 });
		await expect(claude).toContainText('Could not download Claude Code');
		await expect(claude.getByRole('button', { name: 'Try again' })).toBeVisible();
		await captureFlow(app, 'first-run-tools-install-failed');

		await githubAgain.click();
		await expect(githubAgain).toBeVisible({ timeout: 20_000 });
		await expect(github).toHaveAttribute('data-github-status', 'missing');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a signed-out clone dialog asks only to sign in to GitHub, then lists repositories', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { E2E_GITHUB_SIGNED_OUT: '1' } });
	try {
		const { page } = app;
		await recordBrowserAndClipboard(app);
		writeFileSync(
			join(app.home, GITHUB_REPOSITORIES_FIXTURE),
			JSON.stringify([
				{
					full_name: 'e2e/hutch',
					clone_url: 'https://github.com/e2e/hutch.git',
					description: null,
				},
			]),
		);
		await connectFolder(app, 'pasture');
		await page.getByRole('button', { name: 'Find a repository' }).first().click();
		const dialog = page.getByRole('dialog', { name: 'Command center' });
		const github = dialog.getByTestId('github-setup');
		await expect(github).toHaveAttribute('data-github-status', 'signed-out');
		await expect(dialog.getByRole('listbox')).toHaveCount(0);
		await captureFlow(app, 'github-sign-in-clone-dialog');

		await github.getByRole('button', { name: 'Sign in to GitHub' }).click();
		await expect(github.getByLabel('One-time code')).toHaveText('E2E0-C0DE');
		writeFileSync(join(app.home, GITHUB_DEVICE_APPROVED), '');

		const found = dialog.getByRole('listbox', { name: 'Your repositories' });
		await expect(found.getByRole('option', { name: /e2e\/hutch/ })).toBeVisible();
		await expect(github).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
