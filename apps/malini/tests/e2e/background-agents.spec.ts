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

test('a background agent shows as running past the turn, then shows its result', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-background-agent-ws', 'Background agent workstream');
		await openWorkstream(page, 'e2e-background-agent-ws');

		await sendPrompt(page, 'BACKGROUND_AGENT');

		const backgroundStatus = page
			.getByRole('status')
			.filter({ hasText: '1 background agent running' });
		const agentRow = page.getByRole('group').filter({ hasText: 'Sleep probe' });
		const submit = page.getByTestId('chat-composer-submit');
		await expect(backgroundStatus).toBeVisible({ timeout: 20_000 });
		await expect(page.getByText('launched', { exact: true })).toBeVisible();
		await expect(agentRow).toContainText('Background agent');
		await expect(agentRow).toContainText('running…');
		await expect(submit).toHaveAccessibleName('Stop current run');
		await captureFlow(app, 'background-agent-running');

		writeFileSync(join(app.home, 'release-background-agent'), '');

		await expect(agentRow).toContainText('Command completed. Output: probe-done', {
			timeout: 20_000,
		});
		await expect(agentRow).not.toContainText('running…');
		await expect(page.getByRole('status').filter({ hasText: 'background agent' })).toHaveCount(0);
		await expect(page.getByText('The Sleep probe agent finished with probe-done.')).toBeVisible();
		await expect(submit).toHaveAccessibleName('Send prompt');
		await captureFlow(app, 'background-agent-completed');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
