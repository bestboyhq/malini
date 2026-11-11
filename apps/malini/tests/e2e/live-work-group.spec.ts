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

test('a running chat folds its tool calls and the status messages between them into one group', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-live-group', 'Live group');
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'TOOL_STREAM:8:6 NARRATED Read the notes');

		const run = page.locator('li[data-run-id]').last();
		const group = page.getByTestId('chat-activity-group-summary');
		await expect(group).toHaveAccessibleName(/^Exploring [3-7] files$/, { timeout: 20_000 });
		await expect(run).toHaveAttribute('data-run-terminal', 'open');
		await expect(page.getByTestId('chat-activity-group-latest')).toHaveText(
			/^Next I read note [2-8]\.$/,
		);
		await expect(page.getByTestId('chat-activity-group')).toHaveCount(1);
		await expect(page.getByTestId('chat-activity-message')).toHaveCount(0);
		await untilStill(page);
		await captureFlow(app, 'live-work-group-running-latest');

		await expect(run).toHaveAttribute('data-run-terminal', 'completed', { timeout: 30_000 });
		await expect(group).toHaveAccessibleName('Explored 8 files');
		await expect(page.getByTestId('chat-activity-group-latest')).toHaveText('');
		await expect(page.getByTestId('chat-activity-group')).toHaveCount(1);
		await expect(page.getByTestId('chat-message-bubble')).toHaveText([
			'Next I read note 1.',
			'Hello from the fake bridge',
		]);

		await group.click();
		await expect(page.getByTestId('chat-activity-message')).toHaveCount(7);
		await expect(page.getByTestId('chat-activity-message').last()).toHaveText(
			'Next I read note 8.',
		);
		await expect(
			page.getByRole('button', { name: 'Show contents of notes/row-8.txt' }),
		).toBeVisible();
		await untilStill(page);
		await captureFlow(app, 'live-work-group-open-rows');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
