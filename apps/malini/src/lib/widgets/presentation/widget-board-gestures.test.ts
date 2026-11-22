import { describe, expect, it } from 'vitest';
import { slotIndex, snappedSize, withPlaceholder } from './widget-board-gestures';

const row = [
	{ left: 0, top: 0, width: 100, height: 100 },
	{ left: 108, top: 0, width: 100, height: 100 },
];

describe('widget board gestures', () => {
	it('drops before the nearest tile, or after it past its middle and top third', () => {
		expect(slotIndex({ x: 20, y: 50 }, row)).toBe(0);
		expect(slotIndex({ x: 80, y: 50 }, row)).toBe(1);
		expect(slotIndex({ x: 190, y: 90 }, row)).toBe(2);
		expect(slotIndex({ x: 190, y: 10 }, row)).toBe(1);
		expect(slotIndex({ x: 5, y: 5 }, [])).toBe(0);
	});

	it('snaps a resize to small, medium or large', () => {
		expect(snappedSize(110, 120, 124)).toBe('small');
		expect(snappedSize(230, 120, 124)).toBe('medium');
		expect(snappedSize(120, 240, 124)).toBe('large');
		expect(snappedSize(600, 60, 124)).toBe('medium');
	});

	it('puts the placeholder among the other tiles and keeps the dragged one in place', () => {
		expect(withPlaceholder(['a', 'b', 'c'], 'b', 0)).toEqual([null, 'a', 'b', 'c']);
		expect(withPlaceholder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', null, 'c']);
		expect(withPlaceholder(['a', 'b', 'c'], 'b', 2)).toEqual(['a', 'b', 'c', null]);
		expect(withPlaceholder(['a', 'b'], null, 1)).toEqual(['a', null, 'b']);
		expect(withPlaceholder(['a', 'b'], null, null)).toEqual(['a', 'b']);
	});
});
