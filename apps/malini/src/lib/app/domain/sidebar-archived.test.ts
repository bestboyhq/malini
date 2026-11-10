import { describe, expect, it } from 'vitest';
import { ARCHIVED_HEIGHT, archivedOverflows, archivedRowWindow } from './sidebar-archived';

describe('archivedOverflows', () => {
	it('offers more only when the rows do not fit the height', () => {
		expect(archivedOverflows(4, ARCHIVED_HEIGHT.initial)).toBe(false);
		expect(archivedOverflows(5, ARCHIVED_HEIGHT.initial)).toBe(true);
		expect(archivedOverflows(2, ARCHIVED_HEIGHT.min)).toBe(false);
		expect(archivedOverflows(3, ARCHIVED_HEIGHT.min)).toBe(true);
		expect(archivedOverflows(0, ARCHIVED_HEIGHT.min)).toBe(false);
	});
});

describe('archivedRowWindow', () => {
	it('renders the rows in view and a few around them, never the whole history', () => {
		expect(archivedRowWindow(558, 0, ARCHIVED_HEIGHT.initial)).toEqual({ start: 0, end: 12 });
		expect(archivedRowWindow(558, 2400, 480)).toEqual({ start: 92, end: 128 });
		expect(archivedRowWindow(558, 13392, 480)).toEqual({ start: 550, end: 558 });
	});

	it('keeps a short list whole and survives a scroll past a list that shrank', () => {
		expect(archivedRowWindow(8, 0, ARCHIVED_HEIGHT.initial)).toEqual({ start: 0, end: 8 });
		expect(archivedRowWindow(3, 2400, 480)).toEqual({ start: 3, end: 3 });
		expect(archivedRowWindow(0, 0, 0)).toEqual({ start: 0, end: 0 });
	});
});
