import { describe, expect, it } from 'vitest';
import type { RendererFrame } from '$contract/stats';
import { droppedFrames, withoutExplainedGaps } from './frames';

function frame(
	kind: RendererFrame['kind'],
	startedAt: number,
	durationMs: number,
	blockingMs: number | null = null,
): RendererFrame {
	return {
		kind,
		startedAt,
		durationMs,
		focused: true,
		route: '/',
		layoutMs: null,
		blockingMs,
		scripts: [],
	};
}

describe('droppedFrames', () => {
	it('counts the frames a display missed while one frame took too long', () => {
		expect(droppedFrames(100, 120)).toBe(11);
		expect(droppedFrames(34, 60)).toBe(1);
		expect(droppedFrames(8, 120)).toBe(0);
	});
});

describe('withoutExplainedGaps', () => {
	it('drops a frame gap that work on the page explains and keeps one it does not', () => {
		const busy = frame('long-frame', 1_000, 120, 70);
		const explained = frame('frame-gap', 990, 140);
		const unexplained = frame('frame-gap', 2_000, 200);
		const partly = frame('frame-gap', 1_100, 200);

		expect(withoutExplainedGaps([explained, busy, unexplained, partly])).toEqual([
			busy,
			unexplained,
			partly,
		]);
	});

	it('keeps a frame gap that a long frame only waited through, like a stalled GPU', () => {
		const waiting = frame('long-frame', 1_000, 205, 0);
		const gap = frame('frame-gap', 1_000, 200);

		expect(withoutExplainedGaps([waiting, gap])).toEqual([waiting, gap]);
	});
});
