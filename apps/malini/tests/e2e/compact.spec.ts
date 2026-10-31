import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	undoRun,
	visibleRunIds,
} from './harness';

test('a typed /compact compacts the chat in its Claude Code and shows the compaction as a step', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-compact-ws',
			'Compact workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Hello');
		await expectAssistantReply(page);

		const input = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await input.click();
		await page.keyboard.type('Keep this draft /comp', { delay: 10 });
		const commands = page.getByRole('listbox', { name: 'Claude Code commands' });
		await expect(commands.getByRole('option')).toHaveText([/^\/compact/u]);
		const selected = commands.getByRole('option', { name: /^\/compact/u, selected: true });
		await expect(input).toHaveAttribute(
			'aria-activedescendant',
			(await selected.getAttribute('id')) ?? '',
		);
		await page.keyboard.press('Enter');

		await expect(page.getByTestId('job-picker')).toBeHidden();
		await expect(input).toHaveText('Keep this draft');
		const tools = page.locator('[data-message-kind="tool"]');
		await expect(tools.filter({ hasText: 'Compacting conversation' })).toHaveAttribute(
			'data-tool-status',
			'running',
		);
		await captureFlow(app, 'compaction-running');

		writeFileSync(join(app.home, 'release-compaction'), '');
		await expect(tools.filter({ hasText: 'Compacted conversation' })).toHaveAttribute(
			'data-tool-status',
			'completed',
		);
		await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName('Send prompt');
		await captureFlow(app, 'compaction-completed');

		await sendPrompt(page, ' AUTO_COMPACT');
		await expect(tools.filter({ hasText: 'Auto-compacted conversation' })).toHaveAttribute(
			'data-tool-status',
			'completed',
		);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a compaction puts back every message Malini kept, without the turns the user undid', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-record-ws',
			'Record workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'EDIT:cedar.txt');
		await expectAssistantReply(page);
		const [undone] = await visibleRunIds(page);
		if (!undone) throw new Error('the chat has no run to undo');
		await undoRun(page, undone);
		await expect(page.getByTestId('chat-show-undone-toggle')).toBeVisible({ timeout: 30_000 });

		await sendPrompt(page, 'Hello');
		await expectAssistantReply(page);
		await sendPrompt(page, '/compact');
		const tools = page.locator('[data-message-kind="tool"]');
		await expect(tools.filter({ hasText: 'Compacting conversation' })).toHaveAttribute(
			'data-tool-status',
			'running',
		);
		writeFileSync(join(app.home, 'release-compaction'), '');

		const record = page.getByTestId('chat-message-bubble').filter({ hasText: 'Malini put back' });
		await expect(record).toContainText('[user] Hello | [assistant] Hello from the fake bridge', {
			timeout: 30_000,
		});
		await expect(record).toContainText('[user] /compact');
		await expect(record).not.toContainText('cedar');
		await captureFlow(app, 'compaction-record');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
