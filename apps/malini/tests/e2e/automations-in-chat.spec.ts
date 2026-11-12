import { expect, test } from '@playwright/test';
import { holdAgentRuns } from './fake-github';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	listSessions,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	showInspector,
} from './harness';

test('an automation run from the slash list waits in the closed inspector instead of the chat, in the composer tray while the inspector is open, and its transcript opens and closes as a tab of its own', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-chat-automations-ws',
			'Chat automations',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		const chat = currentSessionId(page);
		if (!chat) throw new Error('the chat did not commit a session id');
		await sendPrompt(page, 'HANG');
		const submit = page.getByTestId('chat-composer-submit');
		await expect(submit).toHaveAccessibleName('Stop current run', { timeout: 20_000 });

		const input = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await input.click();
		await page.keyboard.type('/', { delay: 10 });
		const commands = page.getByRole('listbox', { name: 'Claude Code commands' });
		const automations = page.getByRole('listbox', { name: 'Automations' });
		await expect(
			commands.getByRole('option', { name: /^\/compact/u, selected: true }),
		).toBeVisible();
		await page.keyboard.press('ArrowDown');
		await expect(commands.getByRole('option', { selected: true })).toHaveCount(0);
		await expect(
			automations.getByRole('option', { name: /^Fix checks/u, selected: true }),
		).toBeVisible();
		await page.keyboard.press('ArrowDown');
		await expect(
			automations.getByRole('option', { name: /^Fix checks/u, selected: true }),
		).toHaveCount(0);
		await page.keyboard.press('ArrowUp');
		await expect(
			automations.getByRole('option', { name: /^Fix checks/u, selected: true }),
		).toBeVisible();
		await page.keyboard.press('Enter');

		const queued = {
			name: 'Fix checks automation, Queued. The transcript opens once the automation starts',
		};
		const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
		const composerTray = page.getByTestId('chat-composer-tray');
		const tray = inspector.getByRole('region', { name: 'Automations (1)', exact: true });
		await expect(tray.getByRole('button', queued)).toBeVisible({ timeout: 20_000 });
		await expect(composerTray.getByRole('region', { name: /^Automations \(/u })).toHaveCount(0);
		await expect(input).toHaveText('');
		await expect(page.getByRole('article', { name: 'Automation Fix checks' })).toHaveCount(0);
		await captureFlow(app, 'automations-in-chat-queued');

		await showInspector(page);
		await expect(
			composerTray
				.getByRole('region', { name: 'Automations (1)', exact: true })
				.getByRole('button', queued),
		).toBeVisible();
		await expect(tray).toHaveCount(0);
		await page.getByRole('button', { name: 'Hide inspector' }).click();
		await expect(tray.getByRole('button', queued)).toBeVisible();
		await expect(composerTray.getByRole('region', { name: /^Automations \(/u })).toHaveCount(0);

		holdAgentRuns(app, true);
		await submit.click();
		const opener = tray.getByRole('link', {
			name: 'Open transcript: Fix checks automation, Running',
		});
		await expect(opener).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('chat-agent-tab')).toHaveCount(1);
		await expect(page.getByRole('article', { name: 'Automation Fix checks' })).toHaveCount(0);
		await opener.click();
		const automationTab = page.getByRole('tab', { name: /Automation: Fix checks/u });
		await expect(automationTab).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
		await expect.poll(() => currentSessionId(page)).not.toBe(chat);
		const automation = currentSessionId(page);

		holdAgentRuns(app, false);
		await expect(tray).toHaveCount(0, { timeout: 30_000 });
		await page.getByRole('button', { name: 'Close Automation: Fix checks' }).click();
		await expect(automationTab).toHaveCount(0);
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(chat);
		expect((await listSessions(page, workstreamId)).map(({ id }) => id)).toContain(automation);
		await expect(page.getByRole('region', { name: /^Automations \(/u })).toHaveCount(0);
		await expect(page.getByRole('article', { name: 'Automation Fix checks' })).toHaveCount(0);
		await captureFlow(app, 'automations-in-chat-done');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an automation chat shows the effort its automation ran with, and the chat beside it keeps the effort you picked', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-automation-effort-ws',
			'Automation effort',
		);
		await openWorkstream(page, workstreamId);
		const effort = page.getByRole('button', { name: 'Reasoning effort' });
		await effort.click();
		await page
			.getByRole('listbox', { name: 'Reasoning effort levels' })
			.getByRole('option', { name: 'Max' })
			.click();
		await expect(effort).toHaveText('Max');
		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		const chat = currentSessionId(page);
		if (!chat) throw new Error('the chat did not commit a session id');

		const automation = await invoke<{ id: string }>(page, 'automations.save-definition', {
			name: 'Low note',
			instructions: 'EDIT:b.txt',
			model: 'opus',
			effort: 'low',
			runsIn: 'workstream',
		});
		const started = await invoke<{ id: string }>(page, 'automations.run', {
			definitionId: automation.id,
			workstreamId,
		});
		const finished = async () =>
			(
				await invoke<{ id: string; status: string; sessionId: string | null }[]>(
					page,
					'automations.list-runs',
					undefined,
				)
			).find((run) => run.id === started.id);
		await expect
			.poll(async () => (await finished())?.status, { timeout: 60_000 })
			.toBe('succeeded');
		const automationSession = (await finished())?.sessionId;
		if (!automationSession) throw new Error('the automation did not start a chat');

		await openWorkstream(page, workstreamId, automationSession);
		await expect(page.getByRole('tab', { name: /Automation: Low note/u })).toHaveAttribute(
			'aria-current',
			'page',
			{ timeout: 20_000 },
		);
		await expect(effort).toHaveText('Low');
		await captureFlow(app, 'automation-chat-effort');

		await openWorkstream(page, workstreamId, chat);
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(chat);
		await expect(effort).toHaveText('Max');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
