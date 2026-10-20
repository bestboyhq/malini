import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const TURNS = 6;
const OUTPUT_KB = 200;
const PAGE_BYTES = 512 * 1024;
const PREVIEW_CHARS = 8 * 1024;

interface PageEvent {
	readonly seq: number;
	readonly event: Readonly<Record<string, unknown>>;
}

declare global {
	var liveToolOutputs: { length: number; truncated: unknown }[];
}

interface EventPage {
	readonly envelopes: readonly PageEvent[];
	readonly startSeq: number;
	readonly complete: boolean;
}

function prompt(turn: number): string {
	return `paging turn ${turn} BIG_OUTPUT:${OUTPUT_KB}`;
}

async function waitForReplies(page: Page, sessionId: string, count: number): Promise<void> {
	await expect
		.poll(
			async () => {
				const tail = await invoke<EventPage>(page, 'chat.list-event-page', {
					sessionId,
					afterSeq: 0,
					beforeSeq: null,
					byteBudget: Number.MAX_SAFE_INTEGER,
				});
				return tail.envelopes.filter(({ event }) => event['type'] === 'run.completed').length;
			},
			{ timeout: 30_000 },
		)
		.toBe(count);
}

test('a long chat opens on its newest turn and still reaches its first prompt', async () => {
	test.setTimeout(300_000);
	const seeding = await launchMalini();
	let workstreamId = '';
	let sessionId = '';
	try {
		const { page } = seeding;
		const source = await createSourceRepo(seeding.root, 'paging');
		({ workstreamId } = await seedWorkstream(page, source, 'e2e-paging', 'Paging chat'));
		await openWorkstream(page, workstreamId);
		for (let turn = 1; turn <= TURNS; turn += 1) {
			await sendPrompt(page, prompt(turn));
			await expect.poll(() => currentSessionId(page) !== null).toBe(true);
			sessionId = currentSessionId(page) ?? '';
			await waitForReplies(page, sessionId, turn);
		}

		const tail = await invoke<EventPage>(page, 'chat.list-event-page', {
			sessionId,
			afterSeq: 0,
			beforeSeq: null,
			byteBudget: PAGE_BYTES,
		});
		expect(tail.complete).toBe(false);
		expect(tail.envelopes.some(({ event }) => event['text'] === prompt(TURNS))).toBe(true);
		expect(tail.envelopes.some(({ event }) => event['text'] === prompt(1))).toBe(false);

		const older = await invoke<EventPage>(page, 'chat.list-event-page', {
			sessionId,
			afterSeq: 0,
			beforeSeq: tail.startSeq,
			byteBudget: PAGE_BYTES,
		});
		expect(older.envelopes.every(({ seq }) => seq < tail.startSeq)).toBe(true);
		expect(older.envelopes.length).toBeGreaterThan(0);
		expectCleanConsole(seeding);
	} finally {
		await seeding.quit();
	}

	const app = await launchMalini({ profile: seeding.root });
	try {
		const { page } = app;
		const openedAt = Date.now();
		await openWorkstream(page, workstreamId, sessionId);
		await expect(page.getByText(prompt(TURNS), { exact: true })).toBeVisible({ timeout: 20_000 });
		console.log(`transcript-paging newest turn visible after ${Date.now() - openedAt}ms`);

		const scroller = page.getByTestId('chat-message-scroller');
		const firstPrompt = page.getByText(prompt(1), { exact: true });
		await expect
			.poll(
				async () => {
					await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
					return firstPrompt.isVisible();
				},
				{ timeout: 30_000 },
			)
			.toBe(true);
		await expect(firstPrompt).toBeInViewport();
		await captureFlow(app, 'transcript-paging-first-prompt');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a huge tool output travels as a preview and loads whole on demand', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'big-output');
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-big-output', 'Big output');
		await openWorkstream(page, workstreamId);
		await page.evaluate(() => {
			globalThis.liveToolOutputs = [];
			globalThis.malini.on('chat:agent-event', (envelope) => {
				const event =
					typeof envelope === 'object' && envelope !== null && 'event' in envelope
						? envelope.event
						: null;
				if (typeof event !== 'object' || event === null) return;
				if (!('output' in event) || typeof event.output !== 'string') return;
				globalThis.liveToolOutputs.push({
					length: event.output.length,
					truncated: 'outputTruncated' in event ? event.outputTruncated : null,
				});
			});
		});
		await sendPrompt(page, prompt(1));
		await expect.poll(() => currentSessionId(page) !== null).toBe(true);
		const sessionId = currentSessionId(page) ?? '';
		await waitForReplies(page, sessionId, 1);
		expect(await page.evaluate(() => globalThis.liveToolOutputs)).toEqual([
			{ length: PREVIEW_CHARS, truncated: true },
		]);

		const { envelopes } = await invoke<EventPage>(page, 'chat.list-event-page', {
			sessionId,
			afterSeq: 0,
			beforeSeq: null,
			byteBudget: PAGE_BYTES,
		});
		const completed = envelopes.find(({ event }) => event['type'] === 'tool.completed')?.event;
		const preview = completed?.['output'];
		const length = completed?.['outputLength'];
		expect(typeof preview === 'string' ? preview.length : null).toBe(PREVIEW_CHARS);
		expect(completed?.['outputTruncated']).toBe(true);
		expect(typeof length === 'number' && length > OUTPUT_KB * 1_000).toBe(true);

		const full = await invoke<string | null>(page, 'chat.tool-output', {
			sessionId,
			toolCallId: completed?.['toolCallId'],
		});
		expect(full?.length).toBe(length);
		expect(full?.startsWith(typeof preview === 'string' ? preview : '?')).toBe(true);
		expect(full?.endsWith('end of big output')).toBe(true);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
