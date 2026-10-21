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

const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';

declare global {
	var footerFrames: { overlaps: string[]; frames: number; sampling: boolean };
}

test('a finished reply keeps its last line visible and its footer clear of the text', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-run-footer', 'Footer');
		await openWorkstream(page, workstreamId);
		for (let turn = 1; turn <= 4; turn += 1) {
			await sendPrompt(page, `STREAM:12 Turn ${turn}`);
			await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed', {
				timeout: 30_000,
			});
		}

		await sendPrompt(page, 'STREAM:40 Keep talking');
		await expect(page.getByTestId('chat-message-bubble-live')).toContainText(
			'Streamed line 3 of 40.',
			{ timeout: 20_000 },
		);
		await page.getByTestId('chat-message-scroller').evaluate((scroller, latestRun) => {
			const doc = scroller.ownerDocument;
			const view = doc.defaultView;
			if (!view) return;
			type Node = NonNullable<ReturnType<typeof doc.querySelector>>;
			const state = { overlaps: [] as string[], frames: 0, sampling: true };
			globalThis.footerFrames = state;
			const record = (): void => {
				const run = doc.querySelector(latestRun);
				const footer = run?.querySelector('[data-testid="chat-run-actions"]');
				if (!run || !footer) return;
				state.frames += 1;
				const box = footer.getBoundingClientRect();
				const shownBottom = (line: Node): number => {
					let row: Node | null = line;
					while (row && row.parentElement !== run) row = row.parentElement;
					if (!row) return Number.POSITIVE_INFINITY;
					const clip = /inset\(\S+ \S+ ([\d.]+)px/u.exec(view.getComputedStyle(row).clipPath);
					return row.getBoundingClientRect().bottom - Number(clip?.[1] ?? 0);
				};
				for (const line of run.querySelectorAll('p')) {
					const text = line.getBoundingClientRect();
					const bottom = Math.min(text.bottom, shownBottom(line));
					if (bottom > box.top + 1 && text.top < box.bottom - 1) {
						state.overlaps.push(line.textContent?.trim() ?? '');
					}
				}
			};
			const sample = (): void => {
				if (!state.sampling) return;
				const painted = new view.ResizeObserver(() => {
					painted.disconnect();
					record();
				});
				painted.observe(doc.body);
				view.requestAnimationFrame(sample);
			};
			sample();
		}, LATEST_RUN);
		await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed', {
			timeout: 30_000,
		});
		await expect(
			page.locator(LATEST_RUN).getByTestId('buffered-streaming-markdown'),
		).toHaveAttribute('data-buffered-characters', '0');
		await expect(page.locator(`${LATEST_RUN} [data-streaming]`)).toHaveCount(0);
		await untilStill(page);
		const sampled = await page.evaluate(() => {
			globalThis.footerFrames.sampling = false;
			return globalThis.footerFrames;
		});
		await captureFlow(app, 'transcript-run-footer');

		expect(sampled.frames, 'frames sampled with the footer on screen').toBeGreaterThan(10);
		expect([...new Set(sampled.overlaps)], 'text rows the footer was drawn over').toEqual([]);
		const lastLine = page.getByText('Streamed line 40 of 40.', { exact: true });
		await expect(lastLine).toBeInViewport();
		expect(
			await lastLine.evaluate((line) => {
				const box = line.getBoundingClientRect();
				const hit = line.ownerDocument.elementFromPoint(box.left + 4, box.top + box.height / 2);
				return hit !== null && line.contains(hit);
			}),
			'the last streamed line is drawn, not clipped away',
		).toBe(true);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
