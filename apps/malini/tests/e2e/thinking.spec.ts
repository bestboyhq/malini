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

declare global {
	var tickerLines: string[];
}

test('a thinking agent narrates each step live, keeps an opened thought open as it ends, and leaves its reasoning between its tool calls', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-thinking', 'Thinking');
		await openWorkstream(page, seeded.workstreamId);
		await page.locator('body').evaluate((body) => {
			const lines: string[] = [];
			globalThis.tickerLines = lines;
			const view = body.ownerDocument.defaultView;
			if (!view) throw new Error('the transcript has no window');
			new view.MutationObserver(() => {
				const line = body
					.querySelector('[data-testid="thinking-live-preview"] > :last-child')
					?.textContent.trim();
				if (line && line !== lines.at(-1)) lines.push(line);
			}).observe(body, { childList: true, subtree: true, characterData: true });
		});
		await sendPrompt(page, 'THINK');

		const live = page.getByTestId('thinking-live');
		await expect(live).toContainText('Thinking');
		await expect
			.poll(() =>
				page.evaluate(() =>
					globalThis.tickerLines.filter((line) => /[.!?]$/u.test(line)).slice(0, 4),
				),
			)
			.toEqual([
				'The user wants the preview fixed.',
				'It stays open after the gallery closes.',
				'Focus returns to the chip that opened it.',
				'I should read the hover card first.',
			]);
		const sentence = 'The user wants the preview fixed.';
		const lines = await page.evaluate(() => globalThis.tickerLines);
		const narrated = lines.slice(0, lines.indexOf(sentence) + 1);
		const words = sentence.split(' ');
		const prefixes = words.map((_, count) => words.slice(0, count + 1).join(' '));
		expect(narrated, 'the first sentence grows a word at a time').toEqual(
			prefixes.filter((prefix) => narrated.includes(prefix)),
		);
		expect(narrated.slice(0, 1), 'the first frame shows the first word alone').toEqual(['The']);

		const thoughts = page.getByTestId('thinking-summary');
		await expect(thoughts).toHaveCount(1);
		await live.locator('summary').click();
		await expect(live.getByRole('list', { name: 'Thinking steps' })).toBeVisible();
		await captureFlow(app, 'thinking-live');

		await expect(page.getByTestId('chat-message-bubble')).toContainText(
			'Hello from the fake bridge',
			{ timeout: 30_000 },
		);
		await expect(live).toHaveCount(0);

		await expect(thoughts).toHaveCount(2);
		await expect(
			thoughts.nth(1).getByRole('list', { name: 'Thinking steps' }).getByRole('listitem'),
		).toHaveText(['The hover card opens on any focus. I will gate it on keyboard focus.']);
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
