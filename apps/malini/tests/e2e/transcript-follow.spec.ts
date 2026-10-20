import { expect, test, type Page } from '@playwright/test';
import {
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	selectChat,
	sendPrompt,
	startFreshChat,
} from './harness';

type TranscriptBottom = Readonly<{ distanceFromBottom: number; lastRowAboveComposer: boolean }>;

async function transcriptBottom(page: Page): Promise<TranscriptBottom> {
	const distanceFromBottom = await page
		.getByTestId('chat-message-scroller')
		.evaluate((scroller) =>
			Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
		);
	const lastRow = await page.locator('[data-testid="chat-message-list"] > *').last().boundingBox();
	const composer = await page.getByTestId('chat-composer').boundingBox();
	if (!lastRow || !composer) throw new Error('the transcript is not on screen');
	return {
		distanceFromBottom,
		lastRowAboveComposer: lastRow.y + lastRow.height <= composer.y + 1,
	};
}

async function typeDraft(page: Page, lines: readonly string[]): Promise<void> {
	await page.getByTestId('chat-composer-input').click();
	for (const [index, line] of lines.entries()) {
		if (index > 0) await page.keyboard.press('Shift+Enter');
		await page.keyboard.type(line, { delay: 5 });
	}
}

test('a pinned chat keeps its last reply above a composer that grows, and reopens that way', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-follow-ws', 'Follow workstream');
		await openWorkstream(page, seeded.workstreamId);
		for (let turn = 1; turn <= 10; turn += 1) {
			await sendPrompt(page, `Turn ${turn}`);
			await expect(page.getByTestId('chat-message-bubble-user')).toHaveCount(turn, {
				timeout: 20_000,
			});
			await expect(page.getByTestId('chat-message-bubble')).toHaveCount(turn, { timeout: 20_000 });
		}
		const longChat = currentSessionId(page);
		if (!longChat) throw new Error('the long chat did not commit a session id');
		await page.waitForTimeout(600);

		await typeDraft(page, ['one', 'two', 'three', 'four', 'five', 'six']);
		await page.waitForTimeout(800);
		const whileTyping = await transcriptBottom(page);
		expect(whileTyping.lastRowAboveComposer).toBe(true);
		expect(whileTyping.distanceFromBottom).toBeLessThanOrEqual(1);

		await startFreshChat(page);
		await sendPrompt(page, 'Short chat');
		await expectAssistantReply(page);
		await selectChat(page, longChat);
		await page.waitForTimeout(800);
		const reopened = await transcriptBottom(page);
		expect(reopened.lastRowAboveComposer).toBe(true);
		expect(reopened.distanceFromBottom).toBeLessThanOrEqual(1);
	} finally {
		await app.close();
	}
});
