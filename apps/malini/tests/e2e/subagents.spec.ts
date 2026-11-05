import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('each subagent folds into one live line that ticks through its steps, then opens on its report', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-subagents-ws', 'Subagents workstream');
		await openWorkstream(page, 'e2e-subagents-ws');

		await sendPrompt(page, 'SUBAGENTS');

		const rows = page.getByTestId('subagent-row');
		const auth = rows.filter({ hasText: 'Map the auth flow' });
		const tests = rows.filter({ hasText: 'Audit the auth tests' });
		const release = (): void => writeFileSync(join(app.home, 'release-subagent'), '');
		await expect(rows).toHaveCount(2, { timeout: 20_000 });
		await expect(auth).toHaveAttribute('data-tool-status', 'running');
		await expect(auth.getByTestId('subagent-ticker')).toHaveText('Read · src/auth.ts');
		await expect(auth.getByTestId('subagent-meta')).toContainText('1 step');
		await expect(tests.getByTestId('subagent-ticker')).toHaveText('Grep · signIn');
		await expect(page.locator('[data-message-kind="tool"]')).toHaveCount(0);
		await captureFlow(app, 'subagents-running');

		release();

		await expect(auth.getByTestId('subagent-ticker')).toHaveText('Find token reads');
		await expect(auth.getByTestId('subagent-meta')).toContainText('2 steps');
		await expect(tests.getByTestId('subagent-ticker')).toHaveText('Glob · tests/**/*.spec.ts');
		await expect(page.locator('[data-message-kind="bash"]')).toHaveCount(0);
		await captureFlow(app, 'subagents-ticking');

		release();

		await expect(auth).toHaveAttribute('data-tool-status', 'completed', { timeout: 20_000 });
		await expect(auth.getByTestId('subagent-ticker')).toHaveText('Auth runs through src/auth.ts');
		await expect(auth.getByTestId('subagent-meta')).toContainText('2 steps');
		await expect(tests.getByTestId('subagent-ticker')).toHaveText('Two specs cover sign-in.');
		await expect(
			page.getByTestId('markdown-text').getByText('Both agents are back.', { exact: false }),
		).toBeVisible();
		await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName('Send prompt');

		await auth.getByTestId('subagent-summary').click();

		const steps = auth.getByTestId('subagent-steps');
		await expect(steps.getByTestId('subagent-prompt')).toHaveText(
			'Trace how a session token is read and refreshed.',
		);
		await expect(steps.locator('[data-message-kind="tool"]')).toHaveCount(1);
		await expect(steps.locator('[data-message-kind="bash"]')).toHaveCount(1);
		await expect(
			steps.getByTestId('subagent-result').getByRole('heading', { name: 'Auth runs through' }),
		).toBeVisible();
		await expect(page.locator('[data-message-kind="bash"]')).toHaveCount(1);
		await captureFlow(app, 'subagents-opened');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
