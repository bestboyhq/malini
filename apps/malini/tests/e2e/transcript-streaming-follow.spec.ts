import { expect, test, type Page } from '@playwright/test';
import { holdAgentRuns } from './fake-github';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	selectChat,
	sendPrompt,
	startFreshChat,
	type LaunchedApp,
	untilStill,
} from './harness';

declare global {
	var transcriptFrames: { samples: number[][]; sampling: boolean };
	var steeredRunFrames: { samples: number[][]; sampling: boolean };
}

const SCROLLER = '[data-testid="chat-message-scroller"]';
const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';
const LATEST_PROMPT = `${LATEST_RUN} [data-prompt-row]`;
const LATEST_COMMAND = `${LATEST_RUN} [data-testid="bash-command-toggle"]`;
const LATEST_STATUS = `${LATEST_RUN} [data-testid="run-status-line"]`;
const COMPOSER = '[data-testid="chat-composer"]';
const STILL_PX = 1;
const BLANK_PX = 32;
const SCROLL_TOP = 0;
const softly = expect.configure({ soft: true });

async function longChat(app: LaunchedApp, workstreamId: string): Promise<string> {
	const { page } = app;
	const source = await createSourceRepo(app.root);
	const seeded = await seedWorkstream(page, source, workstreamId, 'Streaming follow workstream');
	await openWorkstream(page, seeded.workstreamId);
	for (let turn = 1; turn <= 10; turn += 1) {
		await sendPrompt(page, `Turn ${turn}`);
		await expect(page.getByTestId('chat-message-bubble')).toHaveCount(turn, { timeout: 20_000 });
	}
	const overflow = await page
		.getByTestId('chat-message-scroller')
		.evaluate((scroller) => scroller.scrollHeight - scroller.clientHeight);
	expect(overflow, 'the seeded history overflows the transcript').toBeGreaterThan(200);
	await expect(latestRun(page)).toHaveAttribute('data-run-terminal', 'completed');
	await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(STILL_PX);
	const sessionId = currentSessionId(page);
	if (!sessionId) throw new Error('the long chat did not commit a session id');
	return sessionId;
}

async function startSampling(page: Page, rows: readonly string[]): Promise<void> {
	await page.getByTestId('chat-message-scroller').evaluate(
		(first, { scroller, rows, latestRun, composer }) => {
			const doc = first.ownerDocument;
			const state = { samples: [] as number[][], sampling: true };
			globalThis.transcriptFrames = state;
			const blankAboveComposer = (): number => {
				const run = doc.querySelector(latestRun);
				const composerTop = doc.querySelector(composer)?.getBoundingClientRect().top;
				if (!run || composerTop === undefined) return Number.NaN;
				const runTop = run.getBoundingClientRect().top;
				const bottoms = [...run.children].map((row) =>
					'offsetTop' in row && typeof row.offsetTop === 'number' && 'offsetHeight' in row
						? runTop + row.offsetTop + Number(row.offsetHeight)
						: row.getBoundingClientRect().bottom,
				);
				return composerTop - Math.max(...bottoms);
			};
			const sample = (frameMs: number): void => {
				if (!state.sampling) return;
				state.samples.push([
					doc.querySelector(scroller)?.scrollTop ?? Number.NaN,
					...rows.map((row) => doc.querySelector(row)?.getBoundingClientRect().top ?? Number.NaN),
					frameMs,
					blankAboveComposer(),
				]);
				doc.defaultView?.requestAnimationFrame(sample);
			};
			sample(performance.now());
		},
		{ scroller: SCROLLER, rows, latestRun: LATEST_RUN, composer: COMPOSER },
	);
}

async function stopSampling(page: Page): Promise<number[][]> {
	const samples = await page.evaluate(() => {
		globalThis.transcriptFrames.sampling = false;
		return globalThis.transcriptFrames.samples;
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

function blankAboveComposer(samples: readonly number[][]): number {
	return Math.round(Math.max(...samples.map((sample) => sample.at(-1) ?? Number.NaN)));
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

function jumpOnScreen(samples: readonly number[][], column: number): number {
	let jumped = 0;
	let carriedPxPerMs = 0;
	for (let index = 1; index < samples.length; index += 1) {
		const previous = samples[index - 1] ?? [];
		const current = samples[index] ?? [];
		const moved = (current[column] ?? Number.NaN) - (previous[column] ?? Number.NaN);
		const scrolled = (current[SCROLL_TOP] ?? Number.NaN) - (previous[SCROLL_TOP] ?? Number.NaN);
		const elapsedMs = (current.at(-2) ?? Number.NaN) - (previous.at(-2) ?? Number.NaN);
		const carried = carriedPxPerMs * elapsedMs;
		const pastCarrying = Math.max(0, Math.abs(moved - carried) - Math.abs(carried));
		jumped = Math.max(jumped, Math.min(Math.abs(moved + scrolled), pastCarrying));
		carriedPxPerMs = elapsedMs > 0 ? moved / elapsedMs : 0;
	}
	return Math.round(jumped * 10) / 10;
}

async function visibleBox(
	page: Page,
	selector: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
	const box = await page.locator(selector).boundingBox();
	const scroller = await page.getByTestId('chat-message-scroller').boundingBox();
	if (!box || !scroller) throw new Error(`${selector} is not laid out`);
	const top = Math.max(box.y, scroller.y);
	const bottom = Math.min(box.y + box.height, scroller.y + scroller.height);
	expect(bottom - top, `px of ${selector} in view`).toBeGreaterThan(8);
	return { x: box.x, y: top, width: box.width, height: bottom - top };
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

async function untilLatestRunShows(page: Page, line: string, timeout = 10_000): Promise<void> {
	const latestRunText = (): Promise<string> =>
		page
			.getByTestId('chat-message-scroller')
			.evaluate(
				(scroller, selector) => scroller.ownerDocument.querySelector(selector)?.textContent ?? '',
				LATEST_RUN,
			);
	await expect.poll(latestRunText, { intervals: [50], timeout }).toContain(line);
}

test('a prompt sent into a long chat lands right above the composer, then the transcript follows its reply down', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await longChat(app, 'e2e-streaming-follow-ws');

		await startSampling(page, []);
		await sendPrompt(page, 'STREAM:40 Walk me through it');
		await expect(page.getByTestId('chat-message-bubble-user').last()).toBeInViewport();
		await untilLatestRunShows(page, 'Streamed line 30 of 40.');
		const streaming = await stopSampling(page);

		softly(
			blankAboveComposer(streaming),
			'px of blank space between the streaming run and the composer',
		).toBeLessThanOrEqual(BLANK_PX);
		softly(
			climb(streaming, SCROLL_TOP),
			'px the transcript scrolled back up while it followed the reply',
		).toBeLessThanOrEqual(STILL_PX);
		softly(
			(streaming.at(-1)?.[SCROLL_TOP] ?? 0) - (streaming[0]?.[SCROLL_TOP] ?? 0),
			'px the transcript scrolled down to follow the reply',
		).toBeGreaterThan(200);

		await expectRunFinished(page, 'Streamed line 40 of 40.');
		await untilStill(page);
		await startSampling(page, []);
		await untilStill(page);
		const finished = await stopSampling(page);
		softly(
			blankAboveComposer(finished),
			'px of blank space between the finished run and the composer',
		).toBeLessThanOrEqual(BLANK_PX);
		softly(await distanceFromBottom(page), 'px left below the finished reply').toBeLessThanOrEqual(
			STILL_PX,
		);
		await expect(page.getByTestId('chat-message-viewport')).toHaveAttribute(
			'data-scroll-follow',
			'bottom',
		);
		await expect(newMessagesBelow(page)).toHaveCount(0);
		await captureFlow(app, 'transcript-streaming-follow-streamed');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the working status holds still above the composer while the reply streams in above it', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await longChat(app, 'e2e-streaming-follow-status-ws');
		await sendPrompt(page, 'STREAM:80 Keep talking');
		const reply = page.getByTestId('chat-message-bubble-live');
		await expect(reply).toContainText('Streamed line 3 of 80.', { timeout: 10_000 });

		await startSampling(page, [LATEST_STATUS]);
		await expect(reply).toContainText('Streamed line 20 of 80.', { timeout: 10_000 });
		const streaming = await stopSampling(page);

		expect(
			drift(streaming, 1),
			'px the working status moved while lines arrived above it',
		).toBeLessThanOrEqual(STILL_PX);
		expect(
			(streaming.at(-1)?.[SCROLL_TOP] ?? 0) - (streaming[0]?.[SCROLL_TOP] ?? 0),
			'px the transcript scrolled to follow the reply',
		).toBeGreaterThan(200);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('pointing into an expanded tool call holds the transcript still, and a collapsed one lets it follow the reply', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await longChat(app, 'e2e-streaming-follow-hover-ws');
		await sendPrompt(page, 'STREAM:2 List the files');
		await expectRunFinished(page, 'Streamed line 2 of 2.');
		await page.getByRole('button', { name: 'Expand output for List files' }).click();
		await expect(page.getByTestId('command-output-scroll')).toBeVisible();

		await sendPrompt(page, 'STREAM:40 Keep talking');
		await expect(page.getByTestId('chat-message-bubble-live')).toContainText(
			'Streamed line 3 of 40.',
			{ timeout: 10_000 },
		);

		const expanded = await visibleBox(page, '[data-testid="command-output-scroll"]');
		await page.mouse.move(expanded.x + 40, expanded.y + expanded.height / 2);
		await startSampling(page, []);
		await expect(newMessagesBelow(page)).toBeVisible({ timeout: 10_000 });
		await untilLatestRunShows(page, 'Streamed line 12 of 40.');
		const held = await stopSampling(page);
		expect(
			drift(held, SCROLL_TOP),
			'px the transcript moved under the pointer',
		).toBeLessThanOrEqual(STILL_PX);
		await captureFlow(app, 'transcript-streaming-follow-hover-held');

		const collapsed = await visibleBox(page, LATEST_COMMAND);
		await page.mouse.move(collapsed.x + 40, collapsed.y + collapsed.height / 2);
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
		await longChat(app, 'e2e-streaming-follow-shrink-ws');
		await sendPrompt(page, 'STREAM:2 List the files');
		await expectRunFinished(page, 'Streamed line 2 of 2.');

		await page.getByRole('button', { name: 'Expand output for List files' }).click();
		await expect(page.getByTestId('command-output-scroll')).toBeVisible();
		await untilStill(page);

		await startSampling(page, [LATEST_PROMPT, LATEST_COMMAND]);
		await page.getByRole('button', { name: 'Collapse output for List files' }).click();
		await expect(page.getByTestId('command-output-scroll')).toHaveCount(0);
		await untilStill(page);
		const samples = await stopSampling(page);

		expect(drift(samples, 1), 'the prompt row moved when the output collapsed').toBeLessThanOrEqual(
			STILL_PX,
		);
		expect(
			drift(samples, 2),
			'the command row moved when its output collapsed',
		).toBeLessThanOrEqual(STILL_PX);
		await captureFlow(app, 'transcript-streaming-follow-collapsed');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a job leaving the composer tray leaves the transcript where it is', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const workstreamId = 'e2e-streaming-follow-tray-ws';
		await longChat(app, workstreamId);
		const job = await invoke<{ id: string }>(page, 'jobs.save-definition', {
			name: 'Watch the deploy',
			instructions: 'HANG',
			model: 'opus',
			effort: 'medium',
			runsIn: 'workstream',
		});
		holdAgentRuns(app, true);
		await sendPrompt(page, 'Wait for the deploy job');
		const jobRun = await invoke<{ id: string }>(page, 'jobs.run', {
			definitionId: job.id,
			workstreamId,
		});
		const jobs = page.getByRole('region', { name: 'Jobs (1)', exact: true });
		await expect(jobs).toContainText('Watch the deploy', { timeout: 20_000 });
		holdAgentRuns(app, false);
		await expectRunFinished(page, 'Hello from the fake bridge');
		await untilStill(page);

		await startSampling(page, [LATEST_PROMPT]);
		await invoke(page, 'jobs.cancel-run', { jobRunId: jobRun.id });
		await expect(jobs).toHaveCount(0, { timeout: 20_000 });
		await untilStill(page);
		const samples = await stopSampling(page);

		expect(
			drift(samples, 1),
			'px the transcript moved when the job left the tray',
		).toBeLessThanOrEqual(STILL_PX);
		await captureFlow(app, 'transcript-streaming-follow-job-left-tray');

		await sendPrompt(page, 'Carry on');
		await expectRunFinished(page, 'Hello from the fake bridge');
		await untilStill(page);
		await startSampling(page, []);
		await untilStill(page);
		expect(
			blankAboveComposer(await stopSampling(page)),
			'px of blank space between the next reply and the composer',
		).toBeLessThanOrEqual(BLANK_PX);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('steering a streaming reply keeps what it streamed above the new prompt, and the transcript never jumps back', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await longChat(app, 'e2e-streaming-follow-steer-ws');
		await sendPrompt(page, 'STREAM:400 Keep talking');
		await expect(page.getByTestId('chat-message-bubble-live')).toContainText(
			'Streamed line 6 of 400.',
			{ timeout: 10_000 },
		);
		const steeredRun = page.locator(
			`li[data-run-id="${await latestRun(page).getAttribute('data-run-id')}"]`,
		);

		await startSampling(page, []);
		await page.keyboard.type('Steer now', { delay: 10 });
		await page.keyboard.press('Meta+Enter');
		await expect(steeredRun).toHaveAttribute('data-run-terminal', 'cancelled', {
			timeout: 20_000,
		});
		await expectRunFinished(page, 'Hello from the fake bridge');
		await untilStill(page);
		const samples = await stopSampling(page);

		await expect(steeredRun).toContainText('Streamed line 6 of 400.');
		await expect(steeredRun.getByText('Run cancelled')).toBeVisible();
		expect(
			climb(samples, SCROLL_TOP),
			'px the transcript jumped back up when the steer landed',
		).toBeLessThanOrEqual(STILL_PX);
		await captureFlow(app, 'transcript-streaming-follow-steered');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a steered run keeps its height from the steer to Run cancelled, which takes the place of its timer', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await longChat(app, 'e2e-streaming-follow-steer-still-ws');
		await sendPrompt(page, 'EDIT:b.txt HANG');
		await expect(latestRun(page).getByTestId('run-status-line')).toBeVisible({ timeout: 10_000 });
		await expect(latestRun(page).getByTestId('run-activity-file')).toBeVisible({ timeout: 20_000 });
		await untilStill(page);
		const steeredRunId = await latestRun(page).getAttribute('data-run-id');
		const steeredRun = page.locator(`li[data-run-id="${steeredRunId}"]`);

		await page.evaluate((runId) => {
			const state = { samples: [] as number[][], sampling: true };
			globalThis.steeredRunFrames = state;
			const sample = (): void => {
				if (!state.sampling) return;
				const run = document.querySelector(`li[data-run-id="${runId}"]`);
				state.samples.push([run?.getBoundingClientRect().height ?? Number.NaN]);
				requestAnimationFrame(sample);
			};
			sample();
		}, steeredRunId);
		await page.keyboard.type('Steer now', { delay: 10 });
		await page.keyboard.press('Meta+Enter');
		await expect(steeredRun.getByText('Run cancelled')).toBeVisible({ timeout: 20_000 });
		await expectRunFinished(page, 'Hello from the fake bridge');
		await untilStill(page);
		const heights = await page.evaluate(() => {
			globalThis.steeredRunFrames.sampling = false;
			return globalThis.steeredRunFrames.samples.map(([height]) => height ?? Number.NaN);
		});

		expect(heights.length, 'animation frames sampled').toBeGreaterThan(10);
		expect(
			Math.max(...heights) - Math.min(...heights),
			'px the steered run grew or shrank from the steer to Run cancelled',
		).toBeLessThanOrEqual(STILL_PX);
		await captureFlow(app, 'transcript-streaming-follow-steer-still');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('reopening a chat lands on its latest run right above the composer', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const chat = await longChat(app, 'e2e-streaming-follow-reopen-ws');
		await startFreshChat(page);
		await sendPrompt(page, 'Short chat');
		await expectAssistantReply(page);

		await selectChat(page, chat);
		await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(STILL_PX);
		await startSampling(page, []);
		await untilStill(page);
		const samples = await stopSampling(page);
		expect(
			blankAboveComposer(samples),
			'px of blank space between the latest run and the composer',
		).toBeLessThanOrEqual(BLANK_PX);
		await captureFlow(app, 'transcript-streaming-follow-reopened');

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
		await longChat(app, 'e2e-streaming-follow-reader-ws');
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
		await untilStill(page);
		const after = await scroller.evaluate((element) => element.scrollTop);
		expect(before - after, 'px the wheel scrolled the transcript up').toBeGreaterThan(100);
		await expect(latestRun(page)).toHaveAttribute('data-run-terminal', 'open');

		await startSampling(page, []);
		await expectRunFinished(page, 'Streamed line 40 of 40.');
		await untilStill(page);
		const samples = await stopSampling(page);

		expect(
			drift(samples, SCROLL_TOP),
			'scrollTop moved under a reader who scrolled up',
		).toBeLessThanOrEqual(STILL_PX);
		await expect(newMessagesBelow(page)).toBeVisible();
		await captureFlow(app, 'transcript-streaming-follow-reader');

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

test('a prompt sent after a result card leaves its earlier turns there until its own card, and nothing above the reply jumps', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-report-follow-ws', 'Report follow');
		await openWorkstream(page, seeded.workstreamId);
		const cards = page.getByTestId('turn-report-card');
		for (let turn = 1; turn <= 5; turn += 1) {
			await sendPrompt(page, `CHAT_TURN_REPORT turn ${turn}`);
			await expect(cards).toHaveCount(turn, { timeout: 20_000 });
		}
		await expect(latestRun(page)).toHaveAttribute('data-run-terminal', 'completed');
		await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(STILL_PX);
		const earlierTurns = page.getByRole('list', { name: 'Earlier turns' });
		const reported = await latestRun(page).getAttribute('data-run-id');
		const reportedRun = page.locator(`li[data-run-id="${reported}"]`);
		await expect(reportedRun.getByRole('list', { name: 'Earlier turns' })).toHaveCount(1);

		await startSampling(page, [`li[data-run-id="${reported}"] [data-testid="chat-run-actions"]`]);
		await sendPrompt(page, 'STREAM:30 CHAT_TURN_REPORT turn 6');
		await untilLatestRunShows(page, 'Streamed line 5 of 30.');
		holdAgentRuns(app, true);
		await expect(earlierTurns).toHaveCount(1);
		await expect(reportedRun.getByRole('list', { name: 'Earlier turns' })).toHaveCount(1);
		await untilLatestRunShows(page, 'Streamed line 30 of 30.');
		await untilStill(page);
		await expect(reportedRun.getByRole('list', { name: 'Earlier turns' })).toHaveCount(1);
		holdAgentRuns(app, false);
		await expect(latestRun(page).getByTestId('turn-report-card')).toHaveCount(1, {
			timeout: 20_000,
		});
		await untilStill(page);
		const samples = await stopSampling(page);
		await expect(earlierTurns).toHaveCount(1);
		await expect(latestRun(page).getByRole('list', { name: 'Earlier turns' })).toHaveCount(1);
		expect(
			jumpOnScreen(samples, 1),
			'px the result card above the reply jumped on screen',
		).toBeLessThanOrEqual(STILL_PX);
		await captureFlow(app, 'transcript-report-follow');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a tool row in a run past two hundred steps stays in place while later steps stream in below it', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await longChat(app, 'e2e-long-run-follow-ws');
		await sendPrompt(page, 'TOOL_STREAM:240 Read every note');
		await untilLatestRunShows(page, 'row-226.txt', 60_000);

		await page.getByTestId('chat-message-scroller').evaluate((scroller) => {
			const doc = scroller.ownerDocument;
			const state = { samples: [] as number[][], sampling: true };
			globalThis.transcriptFrames = state;
			const sample = (): void => {
				if (!state.sampling) return;
				const row = [...doc.querySelectorAll('[data-transcript-row]')].find((candidate) =>
					candidate.textContent?.includes('row-225.txt'),
				);
				const view = scroller.getBoundingClientRect();
				const blank = [...doc.querySelectorAll('[data-transcript-placeholder]')].filter(
					(placeholder) => {
						const box = placeholder.getBoundingClientRect();
						return box.bottom > view.top && box.top < view.bottom;
					},
				);
				state.samples.push([
					scroller.scrollTop,
					row?.getBoundingClientRect().top ?? Number.NaN,
					row?.getAttribute('style')?.includes('clip-path') ? 1 : 0,
					blank.length,
				]);
				doc.defaultView?.requestAnimationFrame(sample);
			};
			sample();
		});
		await untilLatestRunShows(page, 'row-236.txt');
		await expect
			.poll(() => page.evaluate(() => globalThis.transcriptFrames.samples.length))
			.toBeGreaterThan(10);
		const samples = await stopSampling(page);
		expect(
			samples.filter((sample) => sample[2] === 1).length,
			'frames the row was clipped away under the step below it',
		).toBe(0);
		expect(
			jumpOnScreen(samples, 1),
			'px the tool row jumped while later steps arrived',
		).toBeLessThanOrEqual(STILL_PX);
		expect(
			samples.filter((sample) => (sample[3] ?? 0) > 0).length,
			'frames a row in view was blank',
		).toBe(0);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
