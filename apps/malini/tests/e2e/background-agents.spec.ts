import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';
import { seedWorkstreamOnFakeGithub, sidebarStatus } from './fake-github';

function sidebarLoader(page: Page, workstreamId: string): Locator {
	return page
		.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`)
		.getByTestId('sidebar-workstream-loader');
}

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
		await expect(agentRow).toHaveAttribute('data-tool-status', 'running');
		await expect(submit).toHaveAccessibleName('Stop current run');
		await expect(sidebarLoader(page, 'e2e-background-agent-ws')).toBeVisible();
		await captureFlow(app, 'background-agent-running');

		writeFileSync(join(app.home, 'release-background-agent'), '');

		await expect(agentRow).toContainText('Command completed. Output: probe-done', {
			timeout: 20_000,
		});
		await expect(agentRow).toHaveAttribute('data-tool-status', 'completed');
		await expect(page.getByRole('status').filter({ hasText: 'background agent' })).toHaveCount(0);
		await expect(
			page
				.getByTestId('markdown-text')
				.getByText('The Sleep probe agent finished with probe-done.'),
		).toBeVisible();
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

		const strip = page.getByRole('region', { name: '1 background command running' });
		const status = page.getByRole('status').filter({ hasText: 'Waiting on 1 background command' });
		const submit = page.getByTestId('chat-composer-submit');
		await expect(strip).toContainText('Run the e2e suite', { timeout: 20_000 });
		await expect(strip).toContainText('✓ 212 passed · 2 running');
		await expect(status).toBeVisible();
		await expect(
			page.getByTestId('markdown-text').getByText('Started the e2e suite in the background.'),
		).toBeVisible();
		await expect(submit).not.toHaveAccessibleName('Stop current run');
		await expect(page.getByTestId('chat-agent-tab')).toHaveAccessibleDescription(
			'Background commands running',
		);
		await expect(sidebarStatus(page, 'e2e-background-command-ws')).toHaveAccessibleName(
			/^Workstream status: Ready/u,
		);
		await expect(sidebarLoader(page, 'e2e-background-command-ws')).toHaveCount(0);
		await captureFlow(app, 'background-command-waiting');

		await sendPrompt(page, 'How is it going?');

		await expect(
			page.getByTestId('markdown-text').getByText('Answered while the e2e suite keeps running.'),
		).toBeVisible({
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

test('a turn that ends while its background command keeps running shows its result and pushes its own commit', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-background-report', null);
		await openWorkstream(page, 'e2e-background-report');
		await sendPrompt(page, 'EDIT:alpha.txt COMMIT=feat: add alpha');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Open a draft pull request' }).click();
		await expect
			.poll(() => github.pushedSubjects(), { timeout: 30_000 })
			.toEqual(['feat: add alpha', 'seed']);

		await sendPrompt(
			page,
			'EDIT:beta.txt BACKGROUND_REPORT COMMIT=test: run the suite in the background',
		);

		const card = page.getByRole('article', { name: 'Turn result' });
		await expect(card.getByTestId('turn-report-outcome')).toHaveText(
			'The e2e suite runs in the background.',
			{ timeout: 20_000 },
		);
		await expect(
			page.getByRole('status').filter({ hasText: 'Waiting on 1 background command' }),
		).toBeVisible();
		await expect
			.poll(() => github.pushedSubjects()[0], { timeout: 30_000 })
			.toBe('test: run the suite in the background');
		await captureFlow(app, 'background-command-report');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('steering a busy run interrupts only its turn, so its background command keeps running', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-background-steer-ws', 'Background steer workstream');
		await openWorkstream(page, 'e2e-background-steer-ws');

		await sendPrompt(page, 'BACKGROUND_BUSY');

		const strip = page.getByRole('region', { name: '1 background command running' });
		const submit = page.getByTestId('chat-composer-submit');
		await expect(strip).toContainText('Run the e2e suite', { timeout: 20_000 });
		await expect(submit).toHaveAccessibleName('Stop current run');
		await captureFlow(app, 'background-command-busy');

		await page.getByTestId('chat-composer-input').click();
		await page.keyboard.type('Skip the wait', { delay: 10 });
		await page.keyboard.press('ControlOrMeta+Enter');

		await expect(
			page.getByTestId('markdown-text').getByText('Answered while the e2e suite keeps running.'),
		).toBeVisible({
			timeout: 20_000,
		});
		await expect(strip).toContainText('Run the e2e suite');
		await expect(
			page.getByRole('status').filter({ hasText: 'Waiting on 1 background command' }),
		).toBeVisible();
		await expect(page.getByTestId('prompt-queue')).toHaveCount(0);
		await captureFlow(app, 'background-command-steered');

		await strip.getByRole('button', { name: 'Stop Run the e2e suite' }).click();
		await expect(strip).toHaveCount(0, { timeout: 20_000 });

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
