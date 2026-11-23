import { describe, expect, it } from 'vitest';
import { WIDGET_SIZE_SPANS } from '$contract/widgets';
import { presetOf, shownSpan, snappedSpan, spanLook, widgetGrid } from './widget-grid';

const GRID = { columns: 4, cell: 124 };

describe('widgetGrid', () => {
	it('keeps two columns on a narrow board', () => {
		expect(widgetGrid(200)).toEqual({ columns: 2, cell: 96 });
	});

	it('adds a column once a third fits at the minimum cell', () => {
		expect(widgetGrid(408)).toEqual({ columns: 3, cell: 130 });
	});
});

describe('shownSpan', () => {
	it('fits a wide span into the board, so large fills it at any width', () => {
		expect(shownSpan(WIDGET_SIZE_SPANS.large, 4)).toEqual({ columns: 4, rows: 2 });
		expect(shownSpan(WIDGET_SIZE_SPANS.large, 2)).toEqual({ columns: 2, rows: 2 });
		expect(shownSpan({ columns: 3, rows: 5 }, 2)).toEqual({ columns: 2, rows: 5 });
	});
});

describe('presetOf', () => {
	it('names a span by the preset it shows as, and no preset for any other span', () => {
		expect(presetOf({ columns: 1, rows: 1 }, 4)).toBe('small');
		expect(presetOf({ columns: 2, rows: 1 }, 4)).toBe('medium');
		expect(presetOf({ columns: 4, rows: 2 }, 4)).toBe('large');
		expect(presetOf({ columns: 2, rows: 2 }, 2)).toBe('large');
		expect(presetOf({ columns: 2, rows: 2 }, 4)).toBeNull();
		expect(presetOf({ columns: 3, rows: 1 }, 4)).toBeNull();
	});
});

describe('spanLook', () => {
	it('draws one column as small, one row as medium and the rest as large', () => {
		expect(spanLook({ columns: 1, rows: 3 })).toBe('small');
		expect(spanLook({ columns: 3, rows: 1 })).toBe('medium');
		expect(spanLook({ columns: 2, rows: 4 })).toBe('large');
	});
});

describe('snappedSpan', () => {
	it('snaps a resize to the nearest cells on the grid', () => {
		expect(snappedSpan(110, 120, GRID, WIDGET_SIZE_SPANS.small)).toEqual({ columns: 1, rows: 1 });
		expect(snappedSpan(390, 400, GRID, WIDGET_SIZE_SPANS.small)).toEqual({ columns: 3, rows: 3 });
		expect(snappedSpan(250, 60, GRID, WIDGET_SIZE_SPANS.small)).toEqual({ columns: 2, rows: 1 });
	});

	it('keeps a resize inside the board and at least one cell', () => {
		expect(snappedSpan(2000, 9000, GRID, WIDGET_SIZE_SPANS.small)).toEqual({
			columns: 4,
			rows: 12,
		});
		expect(snappedSpan(-50, 10, GRID, WIDGET_SIZE_SPANS.small)).toEqual({ columns: 1, rows: 1 });
	});

	it('keeps a full-width widget full width while only its height changes', () => {
		expect(snappedSpan(524, 400, GRID, WIDGET_SIZE_SPANS.large)).toEqual({
			columns: 12,
			rows: 3,
		});
		expect(snappedSpan(390, 260, GRID, WIDGET_SIZE_SPANS.large)).toEqual({
			columns: 3,
			rows: 2,
		});
	});
});
