import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
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
		await expect(claude).toHaveAttribute('data-claude-code-status', 'missing');
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

test('a signed-out Claude Code asks to sign in and the composer will not send', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_CLAUDE_STATE: 'needs_auth' } });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-sign-in-ws', 'Sign in');
		await page.evaluate(() => {
			location.hash = '#/';
		});
		const claude = page.getByTestId('claude-code-setup');
		await expect(claude).toHaveAttribute('data-claude-code-status', 'signed-out');
		await expect(claude.getByRole('button', { name: 'Sign in to Claude Code' })).toBeVisible();
		await expect(claude.getByText('Sign in opens your browser.')).toBeVisible();
		await captureFlow(app, 'first-run-sign-in-claude');

		await openWorkstream(page, workstreamId);
		const picker = page.getByRole('button', { name: 'Model: Default, Claude Code needs setup' });
		await expect(picker).toBeVisible({ timeout: 20_000 });
		await picker.click();
		const setup = page.getByTestId('chat-model-setup');
		await expect(setup).toContainText('Claude Code is installed but not signed in.');
		await expect(setup.getByRole('button', { name: 'Sign in to Claude Code' })).toBeVisible();
		await captureFlow(app, 'model-picker-sign-in-claude');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
