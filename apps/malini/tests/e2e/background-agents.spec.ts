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

test('a background command keeps its run waiting, lets the user keep talking, and stops on request', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(
			page,
			source,
			'e2e-background-command-ws',
			'Background command workstream',
		);
		await openWorkstream(page, 'e2e-background-command-ws');

		await sendPrompt(page, 'BACKGROUND_COMMAND');

		const strip = page.getByRole('region', { name: 'Background work (1)' });
		const status = page.getByRole('status').filter({ hasText: 'Waiting on 1 background command' });
		const submit = page.getByTestId('chat-composer-submit');
		await expect(strip).toContainText('Run the e2e suite', { timeout: 20_000 });
		await expect(strip).toContainText('✓ 212 passed · 2 running');
		await expect(strip).toContainText('The agent resumes when they finish');
		await expect(status).toBeVisible();
		await expect(page.getByText('Started the e2e suite in the background.')).toBeVisible();
		await expect(submit).not.toHaveAccessibleName('Stop current run');
		await captureFlow(app, 'background-command-waiting');

		await sendPrompt(page, 'How is it going?');

		await expect(page.getByText('Answered while the e2e suite keeps running.')).toBeVisible({
			timeout: 20_000,
		});
		await expect(strip).toContainText('Run the e2e suite');
		await expect(status).toBeVisible();
		await expect(page.getByTestId('prompt-queue')).toHaveCount(0);
		await captureFlow(app, 'background-command-handed-off');

		await strip.getByRole('button', { name: 'Stop Run the e2e suite' }).click();

		await expect(strip).toHaveCount(0, { timeout: 20_000 });
		await expect(page.getByRole('status').filter({ hasText: 'background command' })).toHaveCount(0);
		await expect(submit).toHaveAccessibleName('Send prompt');
		await captureFlow(app, 'background-command-stopped');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
