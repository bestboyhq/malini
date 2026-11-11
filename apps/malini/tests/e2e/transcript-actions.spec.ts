import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openActivityGroups,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const REST_FRAMES = 10;

async function untilScrollRests(scroller: Locator): Promise<void> {
	await scroller.evaluate(
		(element, frames) =>
			new Promise<void>((resolve) => {
				const view = element.ownerDocument.defaultView;
				let last = element.scrollTop;
				let still = 0;
				const check = (): void => {
					still = element.scrollTop === last ? still + 1 : 0;
					last = element.scrollTop;
					if (still >= frames || !view) resolve();
					else view.requestAnimationFrame(check);
				};
				view?.requestAnimationFrame(check);
			}),
		REST_FRAMES,
	);
}

test('a failed command says why on its row, an edit shows its size on its row, and a shell code block copies its code', async () => {
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
		await openActivityGroups(page);
		await expect(page.getByText('ESLint found 3 problems', { exact: true })).toBeVisible();
		await expect(page.getByLabel('2 lines added, 1 line removed')).toBeVisible();

		await electronApp.evaluate(({ clipboard }) => clipboard.writeText(''));
		await page.getByRole('button', { name: 'Copy code' }).click();
		await expect(page.getByRole('button', { name: 'Code copied' })).toBeVisible();
		await expect
			.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
			.toBe('pnpm --filter malini test');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a tool failure reads as plain text, with its inline code set as code, on a row, a card and a group', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-tool-failure-ws',
			'Tool failure workstream',
		);
		await openWorkstream(page, workstreamId);
		const idle = (): Promise<void> =>
			expect(page.getByRole('button', { name: 'Stop current run' })).toHaveCount(0);

		const replies = page.getByTestId('chat-message-bubble');
		await sendPrompt(page, 'BASH_BLOCKED');
		await expectAssistantReply(page);
		const row = page.getByTestId('bash-command-failure').first();
		await expect(row).toBeVisible();
		await idle();
		await captureFlow(app, 'tool-failure-row');

		await sendPrompt(page, 'READ_MISSING');
		await expect(replies).toHaveCount(2, { timeout: 30_000 });
		const card = page.getByTestId('tool-card-failed').first();
		await expect(card).toBeVisible();
		await idle();
		await captureFlow(app, 'tool-failure-card');

		await sendPrompt(page, 'BASH_BLOCKED READ_MISSING');
		await expect(replies).toHaveCount(3, { timeout: 30_000 });
		await sendPrompt(page, 'next');
		await expect(replies).toHaveCount(4, { timeout: 30_000 });
		await openWorkstream(page, workstreamId);
		const group = page.locator('li[data-run-id]').nth(2).getByTestId('chat-activity-group-failed');
		await expect(group).toHaveCount(2);
		await group.first().scrollIntoViewIfNeeded();
		await idle();
		await captureFlow(app, 'tool-failure-group');

		await expect(row).toContainText('Blocked: standalone sleep 45. To wait for a condition');
		await expect(row.getByRole('code')).toHaveText('until <check>; do sleep 2; done');
		await expect(card).toContainText('File does not exist.');
		await expect(card.getByRole('code')).toHaveText('/Users/dev/app');
		await expect(group.first()).toContainText('Blocked: standalone sleep 45.');
		await expect(group.last()).toContainText('File does not exist.');
		await expect(page.getByText(/tool_use_error/u)).toHaveCount(0);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a command that exits non-zero shows its exit code quietly, an edit and a read open their file in a card on click, and a context handoff draws a divider', async () => {
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
		await sendPrompt(page, 'EDIT:notes.md EDIT_TOOL READ_TOOL CHAT_BASH_EXIT CHAT_HANDOFF');
		await expectAssistantReply(page);
		await openActivityGroups(page);

		const command = page.getByRole('button', { name: 'Expand output for Run the unit tests' });
		await expect(command).toContainText('pnpm test');
		await expect(command).toContainText('exit 1');
		await expect(page.getByTestId('bash-command-failure')).toHaveCount(0);
		await command.click();
		await expect(page.getByText('1 test failed')).toBeVisible();

		await expect(page.getByText('Context full, handed off to a fresh run')).toBeVisible();
		await expect(page.getByText('Context handed off')).toHaveCount(0);

		const edit = page.getByRole('button', { name: 'Show changes to notes.md' });
		const change = page.getByRole('region', { name: 'Changes to notes.md' });
		await edit.hover();
		await expect(change.getByTestId('diff-line-deleted')).toContainText(['old line']);
		await expect(change.getByTestId('diff-line-added')).toContainText(['new one', 'new two']);
		await expect(page.getByRole('button', { name: 'Hide changes to notes.md' })).toHaveAttribute(
			'aria-expanded',
			'true',
		);
		await captureFlow(app, 'transcript-edit-preview');
		await page.mouse.move(0, 0);
		await expect(change).toHaveCount(0);

		const edited = page.getByRole('button', { name: 'Show current changes to notes.md' });
		const current = page.getByRole('region', { name: 'Current changes to notes.md' });
		await edited.click();
		await expect(current.getByTestId('edit-diff-preview-summary')).toHaveText(/\+1\s*−0/u);
		await page.keyboard.press('Escape');
		await expect(current).toHaveCount(0);

		rmSync(join(worktree, 'notes.md'));
		await edited.click();
		await expect(current).toContainText('Nothing to show for this file');
		await page.keyboard.press('Escape');
		await edit.click();
		await expect(change.getByTestId('diff-line-added')).toContainText(['new one', 'new two']);
		await page.keyboard.press('Escape');

		const read = page.getByRole('region', { name: 'Contents of src/app.ts' });
		await page.getByRole('button', { name: 'Show contents of src/app.ts' }).click();
		await expect(read).toContainText('Lines 10–12');
		await expect(read).toContainText('export function ready(): boolean {');
		await expect(read).not.toContainText('10\texport');
		await captureFlow(app, 'transcript-read-preview');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a file card opens on the first hover after the chat scrolls past its row', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-hover-after-scroll-ws',
			'Hover after scroll workstream',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'EDIT_TOOL STREAM:30 Fill the chat');
		await expect(page.locator('[data-run-terminal="completed"]')).toHaveCount(1, {
			timeout: 30_000,
		});
		await openActivityGroups(page);

		const scroller = page.getByTestId('chat-message-scroller');
		const edit = page.getByRole('button', { name: 'Show changes to notes.md' });
		const box = await scroller.boundingBox();
		if (!box) throw new Error('the transcript is not laid out');
		await page.mouse.move(box.x + box.width - 16, box.y + box.height / 2);
		await expect
			.poll(
				async () => {
					await page.mouse.wheel(0, -400);
					await untilScrollRests(scroller);
					return edit.evaluate((chip) => {
						const rect = chip.getBoundingClientRect();
						const doc = chip.ownerDocument;
						const hit = doc.elementFromPoint(
							rect.left + rect.width / 2,
							rect.top + rect.height / 2,
						);
						return (
							hit !== null &&
							chip.contains(hit) &&
							rect.bottom < doc.documentElement.clientHeight / 2
						);
					});
				},
				{ timeout: 20_000 },
			)
			.toBe(true);

		const chip = await edit.boundingBox();
		if (!chip) throw new Error('the edit chip is not laid out');
		await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
		await expect(page.getByRole('region', { name: 'Changes to notes.md' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
