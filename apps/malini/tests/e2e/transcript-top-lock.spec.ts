import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	selectChat,
	sendPrompt,
	startFreshChat,
	type LaunchedApp,
} from './harness';

declare global {
	var topLock: { samples: number[][]; sampling: boolean };
}

const SCROLLER = '[data-testid="chat-message-scroller"]';
const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';
const LATEST_PROMPT = `${LATEST_RUN} [data-prompt-row]`;
const LATEST_COMMAND = `${LATEST_RUN} [data-testid="bash-command-toggle"]`;
const AT_TOP_PX = 12;
const STILL_PX = 1;
const LANDING_MS = 1_500;
const SCROLL_TOP = 0;
const softly = expect.configure({ soft: true });

async function longChat(app: LaunchedApp, workstreamId: string): Promise<string> {
	const { page } = app;
	const source = await createSourceRepo(app.root);
	const seeded = await seedWorkstream(page, source, workstreamId, 'Top lock workstream');
	await openWorkstream(page, seeded.workstreamId);
	for (let turn = 1; turn <= 10; turn += 1) {
		await sendPrompt(page, `Turn ${turn}`);
		await expect(page.getByTestId('chat-message-bubble')).toHaveCount(turn, { timeout: 20_000 });
	}
	const overflow = await page
		.getByTestId('chat-message-scroller')
		.evaluate((scroller) => scroller.scrollHeight - scroller.clientHeight);
	expect(overflow, 'the seeded history overflows the transcript').toBeGreaterThan(200);
	const sessionId = currentSessionId(page);
	if (!sessionId) throw new Error('the long chat did not commit a session id');
	return sessionId;
}

async function latestPromptOffset(page: Page): Promise<number> {
	return page.getByTestId('chat-message-scroller').evaluate((scroller, selector) => {
		const prompt = scroller.querySelector(selector);
		if (!prompt) throw new Error('the latest run has no prompt row');
		return Math.round(prompt.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
	}, LATEST_PROMPT);
}

async function expectLatestPromptAtTop(page: Page, timeout: number): Promise<void> {
	await softly
		.poll(() => latestPromptOffset(page), {
			timeout,
			intervals: [50],
			message: 'px from the scroller top to the latest prompt row',
		})
		.toBeLessThanOrEqual(AT_TOP_PX);
	softly(
		await latestPromptOffset(page),
		'the latest prompt row is not cut off',
	).toBeGreaterThanOrEqual(-STILL_PX);
}

async function startSampling(page: Page, rows: readonly string[]): Promise<void> {
	await page.getByTestId('chat-message-scroller').evaluate(
		(first, { scroller, rows }) => {
			const doc = first.ownerDocument;
			const state = { samples: [] as number[][], sampling: true };
			globalThis.topLock = state;
			const sample = (): void => {
				if (!state.sampling) return;
				state.samples.push([
					doc.querySelector(scroller)?.scrollTop ?? Number.NaN,
					...rows.map((row) => doc.querySelector(row)?.getBoundingClientRect().top ?? Number.NaN),
				]);
				doc.defaultView?.requestAnimationFrame(sample);
			};
			sample();
		},
		{ scroller: SCROLLER, rows },
	);
}

async function stopSampling(page: Page): Promise<number[][]> {
	const samples = await page.evaluate(() => {
		globalThis.topLock.sampling = false;
		return globalThis.topLock.samples;
	});
	expect(samples.length, 'animation frames sampled').toBeGreaterThan(10);
	expect(
		samples.findIndex((sample) => sample.some(Number.isNaN)),
		'a sampled row left the transcript',
	).toBe(-1);
	return samples;
}

function drift(
	samples: readonly number[][],
	column: number,
	from = 0,
	to = samples.length,
): number {
	const values = samples.map((sample) => sample[column] ?? Number.NaN);
	const first = values[0] ?? Number.NaN;
	const moves = values.slice(from, to).map((value) => Math.abs(value - first));
	return Math.round(Math.max(0, ...moves) * 10) / 10;
}

function climb(samples: readonly number[][], column: number): number {
	let climbed = 0;
	for (let index = 1; index < samples.length; index += 1) {
		const previous = samples[index - 1]?.[column] ?? Number.NaN;
		const current = samples[index]?.[column] ?? Number.NaN;
		climbed = Math.max(climbed, previous - current);
	}
	return Math.round(climbed * 10) / 10;
}

async function distanceFromBottom(page: Page): Promise<number> {
	return page
		.getByTestId('chat-message-scroller')
		.evaluate((scroller) =>
			Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
		);
}

function newMessagesBelow(page: Page) {
	return page.getByRole('button', { name: 'New messages below' });
}

function latestRun(page: Page) {
	return page.locator(LATEST_RUN);
}

async function expectRunFinished(page: Page, lastLine: string): Promise<void> {
	await expect(latestRun(page)).toHaveAttribute('data-run-terminal', 'completed', {
		timeout: 20_000,
	});
	await expect(page.getByTestId('chat-message-bubble').last()).toContainText(lastLine, {
		timeout: 10_000,
	});
}

test('a prompt sent into a long chat lands at the top, then the transcript follows its reply down', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await longChat(app, 'e2e-top-lock-ws');

		await sendPrompt(page, 'STREAM:40 Walk me through it');
		await expectLatestPromptAtTop(page, LANDING_MS);

		await expect(latestRun(page)).toHaveAttribute('data-run-terminal', 'open');
		await startSampling(page, []);
		await expectRunFinished(page, 'Streamed line 40 of 40.');
		await page.waitForTimeout(800);
		const samples = await stopSampling(page);

		softly(
			climb(samples, SCROLL_TOP),
			'px the transcript scrolled back up while it followed the reply',
		).toBeLessThanOrEqual(STILL_PX);
		softly(
			(samples.at(-1)?.[SCROLL_TOP] ?? 0) - (samples[0]?.[SCROLL_TOP] ?? 0),
			'px the transcript scrolled down to follow the reply',
		).toBeGreaterThan(200);
		softly(await distanceFromBottom(page), 'px left below the finished reply').toBeLessThanOrEqual(
			STILL_PX,
		);
		await expect(page.getByTestId('chat-message-viewport')).toHaveAttribute(
			'data-scroll-follow',
			'bottom',
		);
		await expect(newMessagesBelow(page)).toHaveCount(0);
		await captureFlow(app, 'transcript-top-lock-streamed');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('pointing at a tool call holds the transcript still, and leaving it catches up to the reply', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await longChat(app, 'e2e-top-lock-hover-ws');
		await sendPrompt(page, 'STREAM:40 Keep talking');
		await expect(page.getByTestId('chat-message-bubble-live')).toContainText(
			'Streamed line 3 of 40.',
			{ timeout: 10_000 },
		);

		const command = await page.locator(LATEST_COMMAND).boundingBox();
		if (!command) throw new Error('the latest run has no command row');
		await page.mouse.move(command.x + 40, command.y + command.height / 2);
		await startSampling(page, []);
		await expect(newMessagesBelow(page)).toBeVisible({ timeout: 10_000 });
		await page.waitForTimeout(600);
		const held = await stopSampling(page);
		expect(
			drift(held, SCROLL_TOP),
			'px the transcript moved under the pointer',
		).toBeLessThanOrEqual(STILL_PX);
		await captureFlow(app, 'transcript-top-lock-hover-held');

		const composer = await page.getByTestId('chat-composer').boundingBox();
		if (!composer) throw new Error('the composer is not laid out');
		await page.mouse.move(composer.x + composer.width / 2, composer.y + composer.height / 2);
		await expect(newMessagesBelow(page)).toHaveCount(0);
		await expectRunFinished(page, 'Streamed line 40 of 40.');
		await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(STILL_PX);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('collapsing a command output in the latest run leaves the rows above it in place', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await longChat(app, 'e2e-top-lock-shrink-ws');
		await sendPrompt(page, 'STREAM:2 List the files');
		await expectRunFinished(page, 'Streamed line 2 of 2.');

		await page.getByRole('button', { name: 'Expand output for List files' }).click();
		await expect(page.getByTestId('command-output-scroll')).toBeVisible();
		await page.waitForTimeout(800);

		await startSampling(page, [LATEST_PROMPT, LATEST_COMMAND]);
		await page.getByRole('button', { name: 'Collapse output for List files' }).click();
		await expect(page.getByTestId('command-output-scroll')).toHaveCount(0);
		await page.waitForTimeout(800);
		const samples = await stopSampling(page);

		expect(drift(samples, 1), 'the prompt row moved when the output collapsed').toBeLessThanOrEqual(
			STILL_PX,
		);
		expect(
			drift(samples, 2),
			'the command row moved when its output collapsed',
		).toBeLessThanOrEqual(STILL_PX);
		await captureFlow(app, 'transcript-top-lock-collapsed');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('reopening a chat shows its latest prompt at the top when that run fits', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const chat = await longChat(app, 'e2e-top-lock-reopen-ws');
		await startFreshChat(page);
		await sendPrompt(page, 'Short chat');
		await expectAssistantReply(page);

		await selectChat(page, chat);
		const fits = await page
			.getByTestId('chat-message-scroller')
			.evaluate(
				(scroller, selector) =>
					(scroller.querySelector(selector)?.getBoundingClientRect().height ?? Infinity) <
					scroller.clientHeight,
				LATEST_RUN,
			);
		expect(fits, 'the latest run fits in the transcript').toBe(true);
		await expectLatestPromptAtTop(page, 3_000);
		await captureFlow(app, 'transcript-top-lock-reopened');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a reader who scrolled up stays where they are while the reply streams', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await longChat(app, 'e2e-top-lock-reader-ws');
		await sendPrompt(page, 'STREAM:40 Keep talking');
		await expect(page.getByTestId('chat-message-bubble-live')).toContainText(
			'Streamed line 3 of 40.',
			{
				timeout: 10_000,
			},
		);

		const scroller = page.getByTestId('chat-message-scroller');
		const box = await scroller.boundingBox();
		if (!box) throw new Error('the transcript is not laid out');
		const before = await scroller.evaluate((element) => element.scrollTop);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.wheel(0, -400);
		await page.waitForTimeout(400);
		const after = await scroller.evaluate((element) => element.scrollTop);
		expect(before - after, 'px the wheel scrolled the transcript up').toBeGreaterThan(100);
		await expect(latestRun(page)).toHaveAttribute('data-run-terminal', 'open');

		await startSampling(page, []);
		await expectRunFinished(page, 'Streamed line 40 of 40.');
		await page.waitForTimeout(600);
		const samples = await stopSampling(page);

		expect(
			drift(samples, SCROLL_TOP),
			'scrollTop moved under a reader who scrolled up',
		).toBeLessThanOrEqual(STILL_PX);
		await expect(newMessagesBelow(page)).toBeVisible();
		await captureFlow(app, 'transcript-top-lock-reader');

		const nudge = await newMessagesBelow(page).boundingBox();
		if (!nudge) throw new Error('the new messages nudge is not laid out');
		await page.mouse.click(nudge.x + nudge.width / 2, nudge.y + nudge.height / 2);
		await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(STILL_PX);
		await expect(page.getByTestId('chat-message-viewport')).toHaveAttribute(
			'data-scroll-follow',
			'bottom',
		);
		await expect(newMessagesBelow(page)).toHaveCount(0);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
