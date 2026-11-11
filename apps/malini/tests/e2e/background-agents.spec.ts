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
import { seedWorkstreamOnFakeGithub, sidebarStatus, topBarStatus } from './fake-github';

function sidebarLoader(page: Page, workstreamId: string): Locator {
	return page
		.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`)
		.getByTestId('sidebar-workstream-loader');
}

test("a turn's report card shows at once while its background agent runs, then folds into the next report", async () => {
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
		const agentRow = page.getByTestId('subagent-row').filter({ hasText: 'Sleep probe' });
		const submit = page.getByTestId('chat-composer-submit');
		const card = page.getByRole('article', { name: 'Turn result' });
		await expect(backgroundStatus).toBeVisible({ timeout: 20_000 });
		await expect(card).toHaveCount(1);
		await expect(card.getByTestId('turn-report-outcome')).toHaveText(
			'The Sleep probe agent is running',
		);
		await expect(card.getByRole('img', { name: 'Done' })).toBeVisible();
		await expect(page.getByText(/Outcome:|Needs:/u)).toHaveCount(0);
		await expect(agentRow).toHaveAttribute('data-tool-status', 'running');
		await expect(agentRow.getByRole('button', { name: 'Stop Sleep probe' })).toBeVisible();
		await expect(agentRow.getByTestId('subagent-meta')).toHaveText(/^\d+s$/u);
		await expect(page.getByTestId('background-tasks')).toHaveCount(0);
		await expect(submit).toHaveAccessibleName('Stop current run');
		await expect(sidebarLoader(page, 'e2e-background-agent-ws')).toBeVisible();
		await captureFlow(app, 'background-agent-running');

		writeFileSync(join(app.home, 'release-background-agent'), '');

		await expect(agentRow).toContainText('Command completed. Output: probe-done', {
			timeout: 20_000,
		});
		await expect(agentRow).toHaveAttribute('data-tool-status', 'completed');
		await expect(agentRow.getByRole('button', { name: 'Stop Sleep probe' })).toHaveCount(0);
		await expect(page.getByRole('status').filter({ hasText: 'background agent' })).toHaveCount(0);
		await expect(card).toHaveCount(1);
		await expect(card.getByTestId('turn-report-outcome')).toHaveText(
			'The Sleep probe agent finished',
		);
		await expect(
			card.getByRole('list', { name: 'Earlier turns' }).getByRole('listitem'),
		).toHaveText([/The Sleep probe agent is running/u]);
		await expect(page.getByText(/Outcome:|Needs:/u)).toHaveCount(0);
		await expect(submit).toHaveAccessibleName('Send prompt');
		await captureFlow(app, 'background-agent-completed');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a background agent stops from its own row', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-background-agent-stop-ws', 'Background agent stop');
		await openWorkstream(page, 'e2e-background-agent-stop-ws');

		await sendPrompt(page, 'BACKGROUND_AGENT');

		const agentRow = page.getByTestId('subagent-row').filter({ hasText: 'Sleep probe' });
		const stop = agentRow.getByRole('button', { name: 'Stop Sleep probe' });
		await expect(stop).toBeVisible({ timeout: 20_000 });

		await stop.click();

		await expect(agentRow).toHaveAttribute('data-tool-status', 'completed', { timeout: 20_000 });
		await expect(agentRow.getByTestId('subagent-ticker')).toHaveText('Stopped. No hard feelings');
		await expect(stop).toHaveCount(0);
		await expect(page.getByRole('status').filter({ hasText: 'background agent' })).toHaveCount(0);
		await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName('Send prompt');
		await captureFlow(app, 'background-agent-stopped');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a turn that ends over a background command reads as done, lets the user keep talking, and stops the command on request', async () => {
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
		const runStatus = page.getByRole('status').filter({ hasText: /Waiting on|Agent is working/u });
		const submit = page.getByTestId('chat-composer-submit');
		const chatTab = page.getByTestId('chat-agent-tab');
		await expect(strip).toContainText('Run the e2e suite', { timeout: 20_000 });
		await expect(strip).toContainText('✓ 212 passed · 2 running');
		await expect(
			page.getByTestId('markdown-text').getByText('Started the e2e suite in the background.'),
		).toBeVisible();
		await expect(runStatus).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Copy response' }).last()).toBeAttached();
		await expect(submit).toHaveAccessibleName('Send prompt');
		await expect(chatTab).toHaveAccessibleDescription('');
		await expect(topBarStatus(page, /running/u)).toHaveCount(0);
		await expect(sidebarStatus(page, 'e2e-background-command-ws')).toHaveAccessibleName(
			/^Workstream status: Ready/u,
		);
		await expect(sidebarLoader(page, 'e2e-background-command-ws')).toHaveCount(0);
		await captureFlow(app, 'background-command-turn-ended');

		const closing = page.getByRole('dialog', { name: 'Close running chat' });
		await chatTab.hover();
		await page.getByTestId('chat-agent-tab-close').first().click();
		await expect(closing).toBeVisible();
		await closing.getByRole('button', { name: 'Keep working' }).click();
		await expect(closing).toHaveCount(0);
		await expect(strip).toContainText('Run the e2e suite');

		await sendPrompt(page, 'How is it going?');

		await expect(
			page.getByTestId('markdown-text').getByText('Answered while the e2e suite keeps running.'),
		).toBeVisible({
			timeout: 20_000,
		});
		await expect(strip).toContainText('Run the e2e suite');
		await expect(runStatus).toHaveCount(0);
		await expect(chatTab).toHaveAccessibleDescription('');
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
		await expect(page.getByRole('status').filter({ hasText: 'Waiting on' })).toHaveCount(0);
		await expect(page.getByRole('region', { name: '1 background command running' })).toBeVisible();
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
		await expect(page.getByRole('status').filter({ hasText: 'Waiting on' })).toHaveCount(0);
		await expect(submit).toHaveAccessibleName('Send prompt');
		await expect(page.getByTestId('prompt-queue')).toHaveCount(0);
		await captureFlow(app, 'background-command-steered');

		await strip.getByRole('button', { name: 'Stop Run the e2e suite' }).click();
		await expect(strip).toHaveCount(0, { timeout: 20_000 });

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
