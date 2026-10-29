import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	GITHUB_DEVICE_APPROVED,
	GITHUB_REPOSITORIES_FIXTURE,
	captureFlow,
	expectCleanConsole,
	invoke,
	launchMalini,
	recordBrowserAndClipboard,
	recordedBrowserAndClipboard,
} from './harness';

test('setup signs in to GitHub with a one-time code, without a terminal', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { E2E_GITHUB_SIGNED_OUT: '1' } });
	try {
		const { page } = app;
		await recordBrowserAndClipboard(app);
		const setup = page.getByTestId('onboarding');
		await expect(
			setup.getByRole('heading', { name: 'Connect Claude Code and GitHub' }),
		).toBeVisible();
		const github = setup.getByTestId('github-setup');
		await expect(github).toHaveAttribute('data-github-status', 'signed-out', { timeout: 20_000 });
		await expect(setup.getByRole('heading', { name: /^Claude Code Signed in as / })).toBeVisible({
			timeout: 20_000,
		});
		await expect(setup.getByRole('button', { name: 'GitHub', exact: true })).toHaveAttribute(
			'aria-expanded',
			'true',
		);
		await expect(setup.getByRole('button', { name: 'Skip setup' })).toHaveCount(0);
		await expect(setup.getByRole('button', { name: 'Continue' })).toBeDisabled();
		await captureFlow(app, 'github-sign-in-signed-out');

		await github.getByRole('button', { name: 'Connect GitHub' }).click();

		await expect(github.getByLabel('One-time code')).toHaveText('E2E0-C0DE');
		await expect
			.poll(() => recordedBrowserAndClipboard(app))
			.toEqual({ opened: ['https://github.com/login/device'], copied: ['E2E0-C0DE'] });
		await captureFlow(app, 'github-sign-in-code');

		writeFileSync(join(app.home, GITHUB_DEVICE_APPROVED), '');

		await expect(github).toHaveAttribute('data-github-status', 'ready');
		await expect(
			setup.getByRole('heading', { name: 'GitHub Signed in as e2e-user' }),
		).toBeVisible();
		await expect(setup.getByRole('button', { name: 'Connect GitHub' })).toBeHidden();
		await expect(setup.getByRole('button', { name: 'Continue' })).toBeEnabled();
		await captureFlow(app, 'github-sign-in-ready');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('setup shows one account at a time, and the user can pick which one to connect first', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: { E2E_GITHUB_SIGNED_OUT: '1', FAKE_BRIDGE_CLAUDE_STATE: 'missing' },
	});
	try {
		const setup = app.page.getByTestId('onboarding');
		const install = setup.getByRole('button', { name: 'Install Claude Code in Terminal' });
		const connect = setup.getByRole('button', { name: 'Connect GitHub' });
		await expect(install).toBeVisible({ timeout: 20_000 });
		await expect(connect).toBeHidden();
		await captureFlow(app, 'setup-accounts-claude-first');

		await setup.getByRole('button', { name: 'GitHub', exact: true }).click();

		await expect(connect).toBeVisible();
		await expect(install).toBeHidden();
		await expect(setup.getByRole('button', { name: 'Claude Code', exact: true })).toHaveAttribute(
			'aria-expanded',
			'false',
		);
		await captureFlow(app, 'setup-accounts-github-picked');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('after setup, a signed-out clone dialog asks only to connect GitHub, then lists repositories', async () => {
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
		await invoke(page, 'app.set-setting', {
			key: 'onboarding.finished-at',
			value: new Date().toISOString(),
		});
		await page.reload();
		await page.getByRole('button', { name: 'Clone a GitHub repository' }).first().click();
		const dialog = page.getByRole('dialog', { name: 'Clone GitHub repo' });
		const github = dialog.getByTestId('github-setup');
		await expect(github).toHaveAttribute('data-github-status', 'signed-out');
		await expect(dialog.getByRole('textbox')).toHaveCount(0);
		await expect(dialog.getByRole('searchbox')).toHaveCount(0);
		await expect(dialog.getByRole('button', { name: 'Clone repo' })).toHaveCount(0);
		await captureFlow(app, 'github-sign-in-clone-dialog');

		await github.getByRole('button', { name: 'Connect GitHub' }).click();
		await expect(github.getByLabel('One-time code')).toHaveText('E2E0-C0DE');
		writeFileSync(join(app.home, GITHUB_DEVICE_APPROVED), '');

		const recent = dialog.getByRole('list', { name: 'Recent repositories' });
		await expect(recent.getByRole('button', { name: /e2e\/hutch/ })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
