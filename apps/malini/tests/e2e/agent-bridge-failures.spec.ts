import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	startFreshChat,
} from './harness';

test('a prompt the agent refuses goes back into the composer, and the chat says so', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: { FAKE_BRIDGE_REJECT_PROMPT: 'provider exploded' },
		allowedDiagnostics: [/provider exploded/u],
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-refused-ws', 'Refused');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'Ship the fix');
		await expect(
			page.getByText('Prompt could not be sent. Its complete draft was restored.'),
		).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('chat-composer-input')).toHaveText('Ship the fix');
		await captureFlow(app, 'agent-bridge-prompt-refused');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an agent process that stops responding mid-run is announced, and restarting it from the banner lets the chat go on', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: [/heartbeat|bridge/iu] });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-bridge-died-ws', 'Died');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'CHAT_STALL');
		const banner = page.getByRole('status').filter({ hasText: 'Agent process died' });
		await expect(banner).toBeVisible({ timeout: 20_000 });
		await captureFlow(app, 'agent-bridge-died');
		rmSync(join(app.home, 'chat-stalled-bridge'));
		await banner.getByRole('button', { name: 'Restart agent process' }).click();
		await expect(banner).toHaveCount(0, { timeout: 20_000 });
		await expect(page.getByRole('region', { name: 'Run interrupted' })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Run failed' })).toHaveCount(0);
		await captureFlow(app, 'agent-bridge-restarted');

		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a chat whose agent session cannot start says so and takes the whole composer out of service', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({
		env: { FAKE_BRIDGE_REJECT_START: 'START_SESSION_FAILED: provider handle could not boot' },
		allowedDiagnostics: [/START_SESSION_FAILED|could not boot/u],
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-boot-failed-ws', 'No boot');
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'Ship the fix');
		await expect(
			page.getByRole('alert').filter({ hasText: 'Agent session unavailable' }),
		).toBeVisible({ timeout: 20_000 });
		const shell = page.getByTestId('chat-composer-shell');
		await expect(shell).toHaveAttribute('aria-disabled', 'true');
		await expect(page.getByRole('button', { name: /^Model: / })).toBeDisabled();
		await expect(page.getByTestId('chat-composer-submit')).toBeDisabled();
		await captureFlow(app, 'agent-bridge-session-failed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a chat that cannot open keeps its error and its model to itself when you pick another chat', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [/API key cannot be read/u] });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-unreadable-key-ws', 'Key');
		await openWorkstream(page, workstreamId);
		const picker = page.getByRole('button', { name: /^Model: / });
		const failure = page.getByRole('alert').filter({ hasText: 'Agent session unavailable' });

		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		const claudeChat = currentSessionId(page) ?? '';

		await startFreshChat(page);
		await picker.click();
		await page
			.locator(
				'[data-testid="chat-model-option"][data-provider="deepseek"][data-model="deepseek-v4-pro"]',
			)
			.click();
		await sendPrompt(page, 'SEARCH the fixture repo');
		await page.getByRole('textbox', { name: 'DeepSeek API key' }).fill('sk-e2e-deepseek');
		await page.getByTestId('provider-connect-submit').click();
		await expectAssistantReply(page);
		const deepseekChat = currentSessionId(page) ?? '';
		expect(deepseekChat).not.toBe(claudeChat);

		const db = new DatabaseSync(join(app.userDataDir, 'malini.sqlite'), { timeout: 5_000 });
		try {
			db.exec("UPDATE model_providers SET api_key = x'00' WHERE id = 'deepseek'");
		} finally {
			db.close();
		}

		await showChat(page, claudeChat);
		await expect(picker).toHaveAccessibleName('Model: Opus 5.5');
		await showChat(page, deepseekChat);
		await expect(failure).toContainText('The DeepSeek API key cannot be read', {
			timeout: 20_000,
		});

		await showChat(page, claudeChat);
		await expect(failure).toHaveCount(0, { timeout: 20_000 });
		await expect(picker).toHaveAccessibleName('Model: Opus 5.5');
		await expect(picker).toBeEnabled();
		await captureFlow(app, 'agent-bridge-unreadable-key-left-behind');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function showChat(page: Page, sessionId: string): Promise<void> {
	await page.locator(`[data-testid="chat-agent-tab"][data-session-id="${sessionId}"]`).click();
	await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).toBe(sessionId);
}
