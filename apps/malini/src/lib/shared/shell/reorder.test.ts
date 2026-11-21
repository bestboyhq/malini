import { describe, expect, it } from 'vitest';
import { reorderIndex, reorderShift, settledOffset } from './reorder';

const rows = [
	{ start: 0, end: 30 },
	{ start: 32, end: 62 },
	{ start: 64, end: 94 },
];

describe('reorder geometry', () => {
	it('takes a slot once the dragged edge passes the neighbor middle', () => {
		expect(reorderIndex(rows, 0, 16)).toBe(0);
		expect(reorderIndex(rows, 0, 18)).toBe(1);
		expect(reorderIndex(rows, 0, 50)).toBe(2);
		expect(reorderIndex(rows, 2, -18)).toBe(1);
		expect(reorderIndex(rows, 2, -80)).toBe(0);
	});

	it('slides the passed siblings by one row and its gap', () => {
		expect([0, 1, 2].map((index) => reorderShift(rows, 0, 2, index))).toEqual([0, -32, -32]);
		expect([0, 1, 2].map((index) => reorderShift(rows, 2, 0, index))).toEqual([32, 32, 0]);
	});

	it('settles a tall row flush with the slot it takes', () => {
		const groups = [
			{ start: 0, end: 100 },
			{ start: 112, end: 142 },
		];
		expect(settledOffset(groups, 0, 1)).toBe(42);
		expect(settledOffset(groups, 1, 0)).toBe(-112);
		expect(reorderShift(groups, 0, 1, 1)).toBe(-112);
	});

	it('passes a tall group once half of the shorter row overlaps it', () => {
		const groups = [
			{ start: 0, end: 30 },
			{ start: 42, end: 242 },
		];
		expect(reorderIndex(groups, 0, 26)).toBe(0);
		expect(reorderIndex(groups, 0, 28)).toBe(1);
		expect(reorderIndex(groups, 1, -26)).toBe(1);
		expect(reorderIndex(groups, 1, -28)).toBe(0);
	});
});
