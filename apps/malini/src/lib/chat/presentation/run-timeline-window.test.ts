import { describe, expect, it } from 'vitest';
import type { RunTimelineItem } from './run-timeline';
import { windowRunTimeline } from './run-timeline-window';

function assistant(seq: number): RunTimelineItem {
	return { kind: 'assistant', key: `assistant-${seq}`, seq, text: `${seq}` };
}

describe('windowRunTimeline', () => {
	it('keeps the prompt and only the newest activity rows mounted', () => {
		const items: RunTimelineItem[] = [
			{ kind: 'user', key: 'prompt', seq: 1, text: 'Fix it' },
			...Array.from({ length: 5_000 }, (_, index) => assistant(index + 2)),
		];
		const windowed = windowRunTimeline(items, 200);

		expect(windowed.items).toHaveLength(200);
		expect(windowed.items[0]).toMatchObject({ kind: 'user', key: 'prompt' });
		expect(windowed.items.at(-1)).toMatchObject({ key: 'assistant-5001' });
		expect(windowed.hiddenCount).toBe(4_801);
	});

	it('returns the complete chronology once the limit covers it', () => {
		const items = [assistant(1), assistant(2)];
		expect(windowRunTimeline(items, 2)).toEqual({ items, hiddenCount: 0 });
	});

	it('mounts an ordinary 200-row run without a disclosure window', () => {
		const items: RunTimelineItem[] = [
			{ kind: 'user', key: 'prompt', seq: 1, text: 'Fix it' },
			...Array.from({ length: 199 }, (_, index) => assistant(index + 2)),
		];

		expect(windowRunTimeline(items, 200)).toEqual({ items, hiddenCount: 0 });
	});

	it('recovers every older event as the mounted window expands in bounded increments', () => {
		const items: RunTimelineItem[] = [
			{ kind: 'user', key: 'prompt', seq: 1, text: 'Fix it' },
			...Array.from({ length: 120 }, (_, index) => assistant(index + 2)),
		];

		const expandingWindows = Array.from({ length: 12 }, (_, index) => {
			const limit = (index + 1) * 10;
			return { limit, windowed: windowRunTimeline(items, limit) };
		});
		const complete = windowRunTimeline(items, 130);

		for (const { limit, windowed } of expandingWindows) {
			expect(windowed).toMatchObject({ hiddenCount: items.length - limit });
			expect(windowed.items).toHaveLength(limit);
			expect(windowed.items[0]).toMatchObject({ kind: 'user', key: 'prompt' });
			expect(windowed.items.at(-1)).toMatchObject({ key: 'assistant-121' });
		}
		expect(complete).toEqual({ items, hiddenCount: 0 });
	});
});
