import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('a chat lists every file its runs changed, even one edited by hand between runs', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, worktree } = await seedWorkstream(
			page,
			source,
			'e2e-tracking-ws',
			'Tracking workstream',
		);
		await openWorkstream(page, workstreamId);

		const changedFiles = page.getByRole('region', { name: /^Files changed in this chat/u });
		const toggle = changedFiles.getByTestId('chat-changed-files-toggle');

		await sendPrompt(page, 'EDIT:notes.txt');
		await expect(toggle).toContainText('1 file changed in this chat', { timeout: 30_000 });
		await expect(toggle).toContainText('+1');
		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the first prompt did not open a chat');

		writeFileSync(join(worktree, 'notes.txt'), 'written by hand between runs\n');
		await sendPrompt(page, 'EDIT:notes.txt');
		await expect
			.poll(
				async () =>
					(await listEvents(page, sessionId)).filter(
						(entry) => entry.event.type === 'run.completed',
					).length,
				{ timeout: 30_000 },
			)
			.toBe(2);
		await expect(toggle).toContainText('1 file changed in this chat', { timeout: 30_000 });
		await expect(toggle).toContainText('+2');
		await expect(toggle).toContainText('−1');
		await expect(page.getByText(/Only part of this chat is tracked/u)).toHaveCount(0);
		await expect(page.getByText(/Change tracking is/u)).toHaveCount(0);
		await expect(page.getByText(/cannot be undone/u)).toHaveCount(0);

		const lastTurnUndo = page.locator('li[data-run-id]').last().getByTestId('chat-run-undo-arm');
		const expectLastTurnReachable = async () => {
			await lastTurnUndo.click({ trial: true, timeout: 5_000 });
			await page.mouse.move(0, 0);
			await expect(page.getByRole('tooltip')).toHaveCount(0);
		};

		await expectLastTurnReachable();
		await captureFlow(app, 'change-tracking-1-file-collapsed');
		await toggle.click();
		const notes = changedFiles.getByRole('button', {
			name: 'Open notes.txt agent chat diff in Files',
		});
		await expect(notes).toBeVisible();
		await expectLastTurnReachable();
		await captureFlow(app, 'change-tracking-1-file-expanded');
		await toggle.click();

		await sendPrompt(page, 'EDIT:a.txt EDIT:b.txt EDIT:c.txt EDIT:d.txt EDIT:e.txt');
		await expect(toggle).toContainText('6 files changed in this chat', { timeout: 30_000 });
		await expectLastTurnReachable();
		await captureFlow(app, 'change-tracking-6-files-collapsed');
		await toggle.click();
		await expect(
			changedFiles.getByRole('button', { name: 'Open e.txt agent chat diff in Files' }),
		).toBeVisible();
		await expectLastTurnReachable();
		await captureFlow(app, 'change-tracking-6-files-expanded');

		await notes.click();
		const notesDiff = page.getByRole('region', { name: 'Agent chat changes in notes.txt' });
		await expect(notesDiff).toBeVisible({ timeout: 20_000 });
		const runs = (await listEvents(page, sessionId))
			.filter((entry) => entry.event.type === 'run.completed')
			.map((entry) => entry.runId);
		await expect(notesDiff.getByRole('heading', { name: 'Turn 1 · EDIT:notes.txt' })).toBeVisible();
		await expect(notesDiff.getByRole('heading', { name: 'Turn 2 · EDIT:notes.txt' })).toBeVisible();
		await expect(notesDiff.getByRole('heading')).toHaveCount(2);
		await expect(notesDiff.getByText('Net chat change')).toHaveCount(0);
		for (const runId of runs.slice(0, 2)) {
			await expect(notesDiff).toContainText(`agent edit ${runId}`);
		}
		await captureFlow(app, 'change-tracking-diff-turns');

		await changedFiles.getByRole('button', { name: 'Open a.txt agent chat diff in Files' }).click();
		const composedDiff = page.getByRole('region', { name: 'Agent chat changes in a.txt' });
		await expect(composedDiff.getByRole('heading', { name: 'Net chat change' })).toBeVisible({
			timeout: 20_000,
		});
		await captureFlow(app, 'change-tracking-diff-net');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
