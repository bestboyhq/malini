import { expect, test, type Page } from '@playwright/test';
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

const RUNS = '[data-testid="chat-message-list"] > li[data-run-id]';

async function finishRound(page: Page, round: number): Promise<void> {
	await sendPrompt(page, `Round ${round} READ_TOOL EDIT_TOOL CHAT_PLAN`);
	await expect(page.locator(RUNS)).toHaveCount(round, { timeout: 30_000 });
	await expect(page.locator(RUNS).last()).toHaveAttribute('data-run-terminal', 'completed', {
		timeout: 30_000,
	});
}

test('rounds before the previous one fold their work into one line and keep the prompt and answer', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-round-fold', 'Round fold');
		await openWorkstream(page, seeded.workstreamId);
		for (const round of [1, 2, 3, 4]) await finishRound(page, round);

		const runs = page.locator(RUNS);
		const read = { name: 'Show contents of src/app.ts' } as const;
		for (const index of [0, 1]) {
			const run = runs.nth(index);
			await expect(run.getByText(`Round ${index + 1} READ_TOOL`)).toBeVisible();
			await expect(run.getByTestId('chat-message-bubble')).toHaveCount(1);
			await expect(run.getByTestId('chat-work-fold-summary')).toHaveAccessibleName(
				'Edited 2 files',
			);
			await expect(run.getByRole('button', read)).toHaveCount(0);
		}
		for (const index of [2, 3]) {
			await expect(runs.nth(index).getByTestId('chat-work-fold-summary')).toHaveCount(0);
			await expect(runs.nth(index).getByRole('button', read)).toBeVisible();
		}

		const first = runs.first();
		await first.getByTestId('chat-work-fold-summary').click();
		await first.getByTestId('chat-activity-group-summary').click();
		await expect(first.getByRole('button', read)).toBeVisible();
		await untilStill(page);
		await captureFlow(app, 'transcript-round-fold-open');

		await finishRound(page, 5);
		await expect(runs.nth(2).getByTestId('chat-work-fold-summary')).toHaveAccessibleName(
			'Edited 2 files',
		);
		await expect(runs.nth(2).getByRole('button', read)).toHaveCount(0);
		await expect(first.getByRole('button', read)).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
