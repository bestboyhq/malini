import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	selectChat,
	sendPrompt,
	startFreshChat,
} from './harness';

declare global {
	var restoreSampling: { samples: number[]; sampling: boolean };
}

const SCROLLER = '[data-testid="chat-message-scroller"]';
const REPLY = '[data-testid="chat-message-bubble"]';
const READING_PX = 100;
const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';
const RESTORED_PX = 2;

type ReaderView = Readonly<{ selector: string; reply: string; offset: number }>;

async function fillChat(page: Page, firstLineCount: number, turns: number): Promise<string> {
	for (let turn = 0; turn < turns; turn += 1) {
		await sendPrompt(page, `STREAM:${firstLineCount + turn} Turn ${turn + 1}`);
		await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed', {
			timeout: 20_000,
		});
	}
	const sessionId = currentSessionId(page);
	if (!sessionId) throw new Error('the chat did not commit a session id');
	return sessionId;
}

async function readerView(page: Page, sessionId: string): Promise<ReaderView> {
	const selector = `[data-testid="chat-message-viewport"][data-session-id="${sessionId}"] ${REPLY}`;
	const view = await page.locator(SCROLLER).evaluate((scroller, selector) => {
		const top = scroller.getBoundingClientRect().top;
		for (const reply of scroller.ownerDocument.querySelectorAll(selector)) {
			const box = reply.getBoundingClientRect();
			if (box.bottom > top) return { reply: reply.textContent ?? '', offset: box.top - top };
		}
		throw new Error('no reply is on screen');
	}, selector);
	return { selector, ...view };
}

async function replyOffset(page: Page, view: ReaderView): Promise<number | null> {
	return page.locator(SCROLLER).evaluate((scroller, { selector, reply }) => {
		const match = [...scroller.ownerDocument.querySelectorAll(selector)].find(
			(candidate) => candidate.textContent === reply,
		);
		if (!match) return null;
		return match.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
	}, view);
}

async function startSampling(page: Page, view: ReaderView): Promise<void> {
	await page.getByTestId('transcript-pane').evaluate(
		(pane, { scrollerSelector, selector, reply }) => {
			const doc = pane.ownerDocument;
			const state = { samples: [] as number[], sampling: true };
			globalThis.restoreSampling = state;
			const sample = (): void => {
				if (!state.sampling) return;
				const scroller = doc.querySelector(scrollerSelector);
				const match = [...doc.querySelectorAll(selector)].find(
					(candidate) => candidate.textContent === reply,
				);
				if (scroller && match) {
					state.samples.push(
						match.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
					);
				}
				doc.defaultView?.requestAnimationFrame(sample);
			};
			sample();
		},
		{ scrollerSelector: SCROLLER, selector: view.selector, reply: view.reply },
	);
}

async function stopSampling(page: Page): Promise<number[]> {
	return page.evaluate(() => {
		globalThis.restoreSampling.sampling = false;
		return globalThis.restoreSampling.samples;
	});
}

async function expectRestored(page: Page, view: ReaderView, after: string): Promise<void> {
	await expect
		.poll(async () => Math.abs(((await replyOffset(page, view)) ?? Infinity) - view.offset), {
			timeout: 5_000,
			message: `px the reply on top moved from where the reader left it, ${after}`,
		})
		.toBeLessThanOrEqual(RESTORED_PX);
	await page.waitForTimeout(500);
	const samples = await stopSampling(page);
	expect(samples.length, `frames sampled ${after}`).toBeGreaterThan(5);
	const worst = Math.max(...samples.map((offset) => Math.abs(offset - view.offset)));
	expect(worst, `px the transcript jumped while it reopened ${after}`).toBeLessThanOrEqual(
		RESTORED_PX,
	);
	await expect(page.getByTestId('chat-message-viewport')).toHaveAttribute(
		'data-scroll-follow',
		'reader',
	);
}

async function switchChat(page: Page, sessionId: string, view: ReaderView): Promise<void> {
	await startSampling(page, view);
	await selectChat(page, sessionId);
	await expectRestored(page, view, `after switching to chat ${sessionId}`);
}

async function distanceFromBottom(page: Page): Promise<number> {
	return page
		.locator(SCROLLER)
		.evaluate((scroller) =>
			Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
		);
}

async function overflow(page: Page): Promise<number> {
	return page
		.locator(SCROLLER)
		.evaluate((scroller) => scroller.scrollHeight - scroller.clientHeight);
}

async function wheelTranscript(page: Page, deltaY: number): Promise<void> {
	const box = await page.locator(SCROLLER).boundingBox();
	if (!box) throw new Error('the transcript is not laid out');
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.wheel(0, deltaY);
	await page.waitForTimeout(500);
}

async function readFrom(page: Page, sessionId: string, deltaY: number): Promise<ReaderView> {
	await wheelTranscript(page, deltaY);
	await expect(page.getByTestId('chat-message-viewport')).toHaveAttribute(
		'data-scroll-follow',
		'reader',
	);
	return readerView(page, sessionId);
}

async function selectWorkstream(page: Page, workstreamId: string): Promise<void> {
	await page
		.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`)
		.click();
	await expect(page.getByTestId('transcript-pane')).toHaveAttribute(
		'data-workstream-id',
		workstreamId,
		{ timeout: 20_000 },
	);
}

test('each chat reopens where its reader left it, across chat tabs and workstreams', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const reading = await seedWorkstream(page, source, 'e2e-restore-ws', 'Reading workstream');
		const other = await seedWorkstream(page, source, 'e2e-restore-other-ws', 'Other workstream');
		await openWorkstream(page, reading.workstreamId);
		const chatA = await fillChat(page, 4, 8);
		await startFreshChat(page);
		const chatB = await fillChat(page, 4, 8);
		await page.waitForTimeout(600);
		const middle = Math.round((await overflow(page)) / 2);
		expect(middle, 'the chats overflow the transcript').toBeGreaterThan(500);

		const viewB = await readFrom(page, chatB, -middle + READING_PX);
		await selectChat(page, chatA);
		await page.waitForTimeout(600);
		const viewA = await readFrom(page, chatA, -middle - 7);
		await captureFlow(app, 'transcript-scroll-restore-before');

		await switchChat(page, chatB, viewB);
		await switchChat(page, chatA, viewA);

		await selectWorkstream(page, other.workstreamId);
		await selectWorkstream(page, reading.workstreamId);
		await switchChat(page, chatA, viewA);
		await captureFlow(app, 'transcript-scroll-restore-after');

		await wheelTranscript(page, await overflow(page));
		await expect(page.getByTestId('chat-message-viewport')).toHaveAttribute(
			'data-scroll-follow',
			'bottom',
		);
		await selectChat(page, chatB);
		await selectChat(page, chatA);
		await page.waitForTimeout(800);
		expect(await distanceFromBottom(page), 'px the pinned chat reopened above its bottom').toBe(0);
		await expect(page.getByTestId('chat-message-viewport')).toHaveAttribute(
			'data-scroll-follow',
			'bottom',
		);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
