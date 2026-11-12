import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	untilStill,
} from './harness';

test('a chat folds each burst of tool calls between two status messages into one group, and lists the burst at work', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-live-group', 'Live group');
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'TOOL_STREAM:8:6 NARRATED:3 Read the notes');

		const run = page.locator('li[data-run-id]').last();
		const groups = page.getByTestId('chat-activity-group-summary');
		const row = (note: number) =>
			page.getByRole('button', { name: `Show contents of notes/row-${note}.txt` });
		await expect(row(4)).toBeVisible({ timeout: 20_000 });
		await expect(run).toHaveAttribute('data-run-terminal', 'open');
		await expect(groups.first()).toHaveAccessibleName('Explored 3 files');
		await expect(row(1)).toHaveCount(0);
		await expect(run.getByText('Next I read note 4.', { exact: true })).toBeVisible();
		await captureFlow(app, 'live-work-group-running');

		await expect(run).toHaveAttribute('data-run-terminal', 'completed', { timeout: 30_000 });
		await expect(groups).toHaveCount(3);
		for (const [index, name] of [
			'Explored 3 files',
			'Explored 3 files',
			'Explored 2 files',
		].entries()) {
			await expect(groups.nth(index)).toHaveAccessibleName(name);
		}
		await expect(row(4)).toHaveCount(0);
		await expect(page.getByTestId('chat-message-bubble')).toHaveText([
			'Next I read note 1.',
			'Next I read note 4.',
			'Next I read note 7.',
			'Hello from the fake bridge',
		]);
		await untilStill(page);
		await captureFlow(app, 'live-work-group-ended');

		await groups.first().click();
		for (const note of [1, 2, 3]) await expect(row(note)).toBeVisible();
		await expect(row(4)).toHaveCount(0);
		await expect(page.getByTestId('chat-activity-message')).toHaveCount(0);
		await untilStill(page);
		await captureFlow(app, 'live-work-group-open-rows');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the burst at work folds into its group as soon as the next message starts streaming', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-reply-group', 'Reply group');
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'STREAM:40 READS:2 Read the notes, then reply');

		const run = page.locator('li[data-run-id]').last();
		await expect(page.getByTestId('chat-message-bubble-live')).toContainText(
			'Streamed line 3 of 40.',
			{ timeout: 20_000 },
		);
		await expect(run).toHaveAttribute('data-run-terminal', 'open');
		await expect(run.getByTestId('chat-activity-group-summary')).toHaveAccessibleName(
			'Worked 2 files · 1 command',
		);
		await expect(
			page.getByRole('button', { name: 'Show contents of notes/row-1.txt' }),
		).toHaveCount(0);
		await captureFlow(app, 'live-work-group-reply-streaming');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
