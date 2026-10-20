import { expect, test, type Page } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';

async function expectLatestRunCompleted(page: Page): Promise<void> {
	await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed', {
		timeout: 20_000,
	});
}

function transcriptTop(page: Page): Promise<number> {
	return page.getByTestId('chat-message-scroller').evaluate((scroller) => scroller.scrollTop);
}

async function settledTranscriptTop(page: Page): Promise<number> {
	let previous = Number.NaN;
	await expect
		.poll(
			async () => {
				const top = await transcriptTop(page);
				const settled = top === previous;
				previous = top;
				return settled;
			},
			{ intervals: [300] },
		)
		.toBe(true);
	return previous;
}

test('the wheel scrolls the chat while the pointer rests on a code block that scrolls sideways', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-code-block-wheel-ws',
			'Code block wheel workstream',
		);
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'STREAM:30 Fill the chat');
		await expectLatestRunCompleted(page);
		await sendPrompt(page, 'WIDE_CODE');
		await expect(page.locator(LATEST_RUN).getByTestId('markdown-code-block')).toBeVisible();
		await expectLatestRunCompleted(page);

		const code = page.getByTestId('markdown-code-scroll');
		await expect
			.poll(() => code.evaluate((viewport) => viewport.scrollWidth > viewport.clientWidth))
			.toBe(true);
		const before = await settledTranscriptTop(page);
		const box = await code.boundingBox();
		if (!box) throw new Error('the code block is not laid out');
		await page.mouse.move(box.x + box.width / 2, box.y + 12);
		await page.mouse.wheel(0, -300);

		await expect.poll(() => transcriptTop(page)).toBeLessThan(before);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
