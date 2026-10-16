import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	GITHUB_DEVICE_APPROVED,
	GITHUB_REPOSITORIES_FIXTURE,
	captureFlow,
	expectCleanConsole,
	launchMalini,
	type LaunchedApp,
} from './harness';

async function recordBrowserAndClipboard(app: LaunchedApp): Promise<void> {
	await app.electronApp.evaluate(({ clipboard, shell }) => {
		const record: { opened: string[]; copied: string[] } = { opened: [], copied: [] };
		Reflect.set(globalThis, '__githubSignIn', record);
		shell.openExternal = async (url) => {
			record.opened.push(url);
		};
		clipboard.writeText = async (text) => {
			record.copied.push(text);
		};
	});
}

function recorded(app: LaunchedApp): Promise<{ opened: string[]; copied: string[] }> {
	return app.electronApp.evaluate(() => {
		const record: unknown = Reflect.get(globalThis, '__githubSignIn');
		const opened: unknown = Reflect.get(Object(record), 'opened');
		const copied: unknown = Reflect.get(Object(record), 'copied');
		return {
			opened: Array.isArray(opened) ? opened.map(String) : [],
			copied: Array.isArray(copied) ? copied.map(String) : [],
		};
	});
}

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
		await expect(github).toHaveAttribute('data-github-status', 'signed-out');
		await captureFlow(app, 'github-sign-in-signed-out');

		await github.getByRole('button', { name: 'Connect GitHub' }).click();

		await expect(github.getByLabel('One-time code')).toHaveText('E2E0-C0DE');
		await expect
			.poll(() => recorded(app))
			.toEqual({ opened: ['https://github.com/login/device'], copied: ['E2E0-C0DE'] });
		await captureFlow(app, 'github-sign-in-code');

		writeFileSync(join(app.home, GITHUB_DEVICE_APPROVED), '');

		await expect(github).toHaveAttribute('data-github-status', 'ready');
		await expect(github.getByText('Signed in as e2e-user')).toBeVisible();
		await expect(github.getByText('Ready')).toBeVisible();
		await captureFlow(app, 'github-sign-in-ready');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the clone dialog asks only to connect GitHub, then lists repositories once it is connected', async () => {
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
		const setup = page.getByTestId('onboarding');
		await setup.getByRole('button', { name: 'Skip setup' }).click();
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
