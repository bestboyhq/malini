import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	currentSessionId,
	expectCleanConsole,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('a failed command says why on its row, an edit shows its size on its row, and a shell code block copies its code and runs it in the chat', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-transcript-actions-ws',
			'Transcript actions workstream',
		);
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'BASH_FAIL EDIT_TOOL CODE');
		await expectAssistantReply(page);
		await expect(page.getByText('ESLint found 3 problems', { exact: true })).toBeVisible();
		await expect(page.getByLabel('2 lines added, 1 line removed')).toBeVisible();

		await electronApp.evaluate(({ clipboard }) => clipboard.writeText(''));
		await page.getByRole('button', { name: 'Copy code' }).click();
		await expect(page.getByRole('button', { name: 'Code copied' })).toBeVisible();
		await expect
			.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
			.toBe('pnpm --filter malini test');

		const codeBlock = page.getByTestId('markdown-code-block');
		await codeBlock.getByRole('button', { name: 'Run command' }).hover();
		await expect(page.getByRole('tooltip', { name: 'Run in this chat' })).toBeVisible();
		await captureFlow(app, 'transcript-code-run');
		await codeBlock.getByRole('button', { name: 'Run command' }).click();
		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the chat has no session');
		await expect
			.poll(async () =>
				(await listEvents(page, sessionId)).flatMap(({ event }) =>
					event.type === 'user.message' ? [String(event['text'])] : [],
				),
			)
			.toEqual(['BASH_FAIL EDIT_TOOL CODE', 'Run this:\n```sh\npnpm --filter malini test\n```']);
		await expect(page.locator('[data-message-kind="user"]').last()).toContainText('Run this:');
		await captureFlow(app, 'transcript-code-run-sent');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a command that exits non-zero shows its exit code quietly, an edit previews the current changes to its file, and a context handoff draws a divider', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, worktree } = await seedWorkstream(
			page,
			source,
			'e2e-transcript-rows-ws',
			'Transcript rows workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'EDIT:notes.md EDIT_TOOL CHAT_BASH_EXIT CHAT_HANDOFF');
		await expectAssistantReply(page);

		const command = page.getByRole('button', { name: 'Expand output for Run the unit tests' });
		await expect(command).toContainText('pnpm test');
		await expect(command).toContainText('exit 1');
		await expect(page.getByTestId('bash-command-failure')).toHaveCount(0);
		await command.click();
		await expect(page.getByText('1 test failed')).toBeVisible();

		await expect(page.getByText('Context full, handed off to a fresh run')).toBeVisible();
		await expect(page.getByText('Context handed off')).toHaveCount(0);

		const preview = page.getByRole('button', { name: 'Preview current changes to notes.md' });
		const changes = page.getByRole('dialog', { name: 'Current changes to notes.md' });
		await preview.click();
		await expect(changes.getByTestId('edit-diff-preview-summary')).toHaveText(/\+1\s*−0/u);
		await captureFlow(app, 'transcript-edit-preview');
		await page.keyboard.press('Escape');
		await expect(changes).toHaveCount(0);

		rmSync(join(worktree, 'notes.md'));
		await preview.click();
		await expect(changes).toContainText('Nothing to show for this file');
		await page.keyboard.press('Escape');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
