import { basename } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('Run executes a code block in the workstream at once, takes typed answers, stops, and the agent reads what it printed', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, worktree } = await seedWorkstream(
			page,
			source,
			'e2e-shell-run-ws',
			'Shell run workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'SHELL_BLOCKS');
		await expectAssistantReply(page);
		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the chat has no session');

		const [askBlock, serveBlock] = [0, 1].map((index) =>
			page.getByTestId('markdown-code-block').nth(index),
		);
		if (!askBlock || !serveBlock) throw new Error('the reply has no code blocks');
		await askBlock.getByRole('button', { name: 'Run command' }).hover();
		await expect(page.getByRole('tooltip', { name: 'Run in this workstream' })).toBeVisible();
		await askBlock.getByRole('button', { name: 'Run command' }).click();

		const ask = page.getByTestId('shell-run').filter({ hasText: 'read name' });
		const askOutput = ask.getByRole('log', { name: 'Output' });
		await expect(askOutput).toContainText('Your name?', { timeout: 20_000 });
		await expect(ask).toHaveAttribute('data-state', 'running');
		await askOutput.click();
		await expect(ask.getByRole('textbox', { name: /^Type into / })).toBeFocused();
		await page.keyboard.type('Simon');
		await captureFlow(app, 'shell-run-typing');
		await page.keyboard.press('Enter');
		await expect(askOutput).toContainText(`hi Simon in ${basename(worktree)}`);
		await expect(ask.getByTestId('shell-run-status')).toHaveText('exit 0');

		await serveBlock.getByRole('button', { name: 'Run command' }).click();
		const serve = page.getByTestId('shell-run').filter({ hasText: 'sleep 300' });
		await expect(serve.getByRole('log', { name: 'Output' })).toContainText('serving', {
			timeout: 20_000,
		});
		await captureFlow(app, 'shell-run-running');
		await serve.getByRole('button', { name: 'Stop command' }).click();
		await expect(serve.getByTestId('shell-run-status')).toHaveText('stopped', { timeout: 20_000 });
		await serve.getByRole('button', { name: 'Dismiss command' }).click();
		await expect(serve).toHaveCount(0);

		const prompts = async (): Promise<string[]> =>
			(await listEvents(page, sessionId)).flatMap(({ event }) =>
				event.type === 'user.message' ? [String(event['text'])] : [],
			);
		expect(await prompts()).toEqual(['SHELL_BLOCKS']);

		await sendPrompt(page, 'ECHO_SHELL_RUNS what did it say?');
		const reply = page.getByTestId('chat-message-bubble').last();
		await expect(reply).toContainText('You ran: exited 0 Your name? Simon', { timeout: 30_000 });
		await expect(reply).toContainText(`hi Simon in ${basename(worktree)}`);
		await expect(reply).not.toContainText('serving');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
