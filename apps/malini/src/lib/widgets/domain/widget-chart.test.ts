import { describe, expect, it } from 'vitest';
import {
	barLayout,
	chartCount,
	chartDetail,
	chartScale,
	labelIndexes,
	lineRuns,
	monotonePath,
	sparkScale,
} from './widget-chart';

function pathNumbers(path: string): number[] {
	return [...path.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map(([number]) => Number(number));
}

describe('chartDetail', () => {
	it('draws a sparkline when short or narrow, axes when large', () => {
		expect(chartDetail(112, 200)).toBe('tiny');
		expect(chartDetail(300, 50)).toBe('tiny');
		expect(chartDetail(200, 90)).toBe('medium');
		expect(chartDetail(260, 150)).toBe('large');
	});
});

describe('monotonePath', () => {
	it('passes through every point without overshooting the data', () => {
		const points = [0, 10, 10, 40, 0, 0].map((y, index) => ({ x: index * 20, y }));
		const numbers = pathNumbers(monotonePath(points));
		const ys = numbers.filter((_, index) => index % 2 === 1);
		expect(numbers.slice(0, 2)).toEqual([0, 0]);
		expect(numbers.slice(-2)).toEqual([100, 0]);
		expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...ys)).toBeLessThanOrEqual(40);
	});

	it('draws a straight segment for two points and nothing for none', () => {
		expect(
			pathNumbers(
				monotonePath([
					{ x: 0, y: 0 },
					{ x: 30, y: 30 },
				]),
			),
		).toEqual([0, 0, 10, 10, 20, 20, 30, 30]);
		expect(monotonePath([])).toBe('');
	});
});

describe('lineRuns', () => {
	it('breaks the line at gaps', () => {
		const point = { x: 0, y: 0 };
		expect(lineRuns([point, point, null, point, null, null]).map((run) => run.length)).toEqual([
			2, 1,
		]);
	});
});

describe('chartScale', () => {
	it('starts at zero and rounds the top to a nice tick', () => {
		expect(chartScale([12, 37], 4)).toEqual({ low: 0, high: 40, ticks: [0, 10, 20, 30, 40] });
		expect(chartScale([1], 4).high).toBe(4);
		expect(chartScale([-3, 9], 4).low).toBeLessThan(0);
	});

	it('fits a sparkline to its values, from zero for columns', () => {
		expect(sparkScale([12, 30], false)).toMatchObject({ low: 12, high: 30 });
		expect(sparkScale([12, 30], true)).toMatchObject({ low: 0, high: 30 });
		expect(sparkScale([5, 5], false)).toMatchObject({ low: 4, high: 6 });
	});
});

describe('labelIndexes', () => {
	it('spreads labels from the first point to the last', () => {
		expect(labelIndexes(14, 2)).toEqual([0, 13]);
		expect(labelIndexes(14, 4)).toEqual([0, 4, 9, 13]);
		expect(labelIndexes(3, 7)).toEqual([0, 1, 2]);
	});
});

describe('barLayout', () => {
	it('keeps bars between 3 and 16 px, 24 px for few categories', () => {
		expect(barLayout(4, 60, 1).width).toBeCloseTo(3);
		expect(barLayout(100, 30, 1).width).toBe(16);
		expect(barLayout(100, 5, 1).width).toBe(24);
	});

	it('groups series around the slot center', () => {
		const { offsets } = barLayout(40, 5, 2);
		expect(offsets[0]).toBeLessThan(0);
		expect((offsets[0] ?? 0) + (offsets[1] ?? 0)).toBeCloseTo(0);
	});
});

describe('chartCount', () => {
	it('shortens counts from ten thousand', () => {
		expect(chartCount(9_999)).toBe('9,999');
		expect(chartCount(12_400)).toBe('12.4K');
		expect(chartCount(2.25)).toBe('2.3');
	});
});
