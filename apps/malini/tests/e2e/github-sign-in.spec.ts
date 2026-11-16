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

test('GitHub on the picker signs in with a one-time code it asks for on its own, then lists your repositories', async () => {
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
		for (const name of ['GitHub', 'A folder on this Mac', 'New repository']) {
			await expect(chooser.getByRole('button', { name, exact: true })).toBeVisible();
		}
		await expect(chooser.getByText(/sign in/iu)).toHaveCount(0);
		await captureFlow(app, 'github-sign-in-doors');

		await chooser.getByRole('button', { name: 'GitHub', exact: true }).click();
		const github = chooser.getByTestId('first-repository-github');
		await expect(github.getByLabel('One-time code')).toHaveText('E2E0-C0DE', { timeout: 20_000 });
		await expect(github.getByRole('status')).toHaveText(['Paste this code on GitHub']);
		await expect
			.poll(() => recordedBrowserAndClipboard(app))
			.toEqual({ opened: ['https://github.com/login/device'], copied: ['E2E0-C0DE'] });
		await expect(github).not.toContainText('GitHub CLI');
		await captureFlow(app, 'github-sign-in-code');

		writeFileSync(join(app.home, GITHUB_DEVICE_APPROVED), '');

		await expect(
			github
				.getByRole('list', { name: 'Your GitHub repositories' })
				.getByRole('button', { name: 'e2e/hutch' }),
		).toBeVisible({ timeout: 20_000 });
		await captureFlow(app, 'github-sign-in-ready');

		await github.getByRole('button', { name: 'Back' }).click();
		await expect(chooser.getByRole('button', { name: 'GitHub', exact: true })).toBeVisible();
		await chooser.getByRole('button', { name: 'GitHub', exact: true }).click();
		await expect(github.getByRole('button', { name: 'e2e/hutch' })).toBeVisible();
		expect((await recordedBrowserAndClipboard(app)).opened).toHaveLength(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a missing GitHub CLI installs on its own, and GitHub on the picker says why it failed', async () => {
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
		const chooser = page.getByRole('region', { name: 'Your repositories' });
		await chooser.getByRole('button', { name: 'GitHub', exact: true }).click();
		const problem = chooser.getByTestId('first-repository-github-problem');
		await expect(problem).toHaveRole('alert', { timeout: 20_000 });
		await expect(problem).toContainText('Could not load your repositories');
		await expect(problem).toContainText('Could not download the GitHub CLI');
		await expect(page.getByTestId('claude-code-install-status')).toHaveCount(0);
		await captureFlow(app, 'first-run-tools-install-failed');

		const again = problem.getByRole('button', { name: 'Try again' });
		await again.click();
		await expect(again).toBeVisible({ timeout: 20_000 });
		await expect(problem).toContainText('Could not download the GitHub CLI');
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
