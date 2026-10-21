import { describe, expect, it } from 'vitest';
import { RENAME_BAND_PX, renameSweepFrame } from './rename-sweep';

const STEPS = 1500;

describe('rename sweep', () => {
	it.each([
		[53, 139],
		[53, 60],
		[53, 53],
		[53, 29],
		[0, 50],
		[8, 4],
	])('moves a %dpx label to %dpx without a jump and rests with no band on the text', (from, to) => {
		const frames = Array.from({ length: STEPS + 1 }, (_, step) =>
			renameSweepFrame(step / STEPS, from, to),
		);
		const first = frames[0];
		const last = frames[STEPS];
		if (!first || !last) throw new Error('no frames');

		expect(first.width).toBeCloseTo(from, 9);
		expect(last.width).toBeCloseTo(to, 9);
		expect(first.dim).toBe(0);
		expect(last.dim).toBe(0);
		expect(first.center + RENAME_BAND_PX / 2).toBeLessThanOrEqual(0);
		expect(last.center - RENAME_BAND_PX / 2).toBeGreaterThanOrEqual(Math.max(from, to));

		const largestStep = Math.max(
			...frames.slice(1).map((frame, index) => Math.abs(frame.width - (frames[index]?.width ?? 0))),
		);
		expect(largestStep).toBeLessThan(0.5);
	});
});
