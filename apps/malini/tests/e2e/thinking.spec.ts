import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('a thinking agent narrates each step live and leaves its reasoning between its tool calls', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-thinking', 'Thinking');
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'THINK');

		const live = page.getByTestId('thinking-live');
		await expect(live).toContainText('Thinking');
		const ticker = live.getByTestId('thinking-live-preview');
		for (const sentence of [
			'The user wants the preview fixed.',
			'It stays open after the gallery closes.',
			'Focus returns to the chip that opened it.',
			'I should read the hover card first.',
		]) {
			await expect(ticker).toHaveText(sentence);
		}
		await captureFlow(app, 'thinking-live');

		await expect(page.getByTestId('chat-message-bubble')).toContainText(
			'Hello from the fake bridge',
			{ timeout: 30_000 },
		);
		await expect(live).toHaveCount(0);

		const thoughts = page.getByTestId('thinking-summary');
		await expect(thoughts).toHaveCount(2);
		await expect(thoughts.first().getByTestId('thinking-outcome')).toHaveText(
			'Focus returns to the chip that opened it. I should read the hover card first.',
		);

		await sendPrompt(page, 'next');
		await expect(page.getByTestId('chat-message-bubble')).toHaveCount(2, { timeout: 30_000 });
		await openWorkstream(page, seeded.workstreamId);
		const earlier = page.locator('li[data-run-id]').first();
		await expect(earlier.getByTestId('chat-activity-group')).toHaveCount(2);
		const folded = earlier.getByTestId('thinking-summary');
		await expect(folded).toHaveCount(2);
		await expect(folded.first()).toBeVisible();
		await expect(folded.first().getByTestId('thinking-outcome')).toHaveText(
			'Focus returns to the chip that opened it. I should read the hover card first.',
		);

		await folded.first().getByText('Thought', { exact: true }).click();
		await expect(
			folded.first().getByRole('list', { name: 'Thinking steps' }).getByRole('listitem'),
		).toHaveText([
			'The user wants the preview fixed. It stays open after the gallery closes.',
			'Focus returns to the chip that opened it. I should read the hover card first.',
		]);
		await captureFlow(app, 'thinking-steps');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
