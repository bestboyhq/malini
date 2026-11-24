import { describe, expect, it } from 'vitest';
import type { WidgetSpan } from '$contract/widgets';
import { dropIndex, pack, shownSpan, snappedSpan, spanLook, widgetGrid } from './widget-grid';

const GRID = { columns: 4, cell: 124 };
const STEP = 132;
const SMALL: WidgetSpan = { columns: 1, rows: 1 };
const MEDIUM: WidgetSpan = { columns: 2, rows: 1 };
const LARGE: WidgetSpan = { columns: 12, rows: 2 };

function centreOf(column: number, row: number, span: WidgetSpan): { x: number; y: number } {
	return {
		x: column * STEP + (span.columns * STEP - 8) / 2,
		y: row * STEP + (span.rows * STEP - 8) / 2,
	};
}

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
		expect(shownSpan(LARGE, 4)).toEqual({ columns: 4, rows: 2 });
		expect(shownSpan(LARGE, 2)).toEqual({ columns: 2, rows: 2 });
		expect(shownSpan({ columns: 3, rows: 5 }, 2)).toEqual({ columns: 2, rows: 5 });
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
		expect(snappedSpan(110, 120, GRID, SMALL)).toEqual({ columns: 1, rows: 1 });
		expect(snappedSpan(390, 400, GRID, SMALL)).toEqual({ columns: 3, rows: 3 });
		expect(snappedSpan(250, 60, GRID, SMALL)).toEqual({ columns: 2, rows: 1 });
	});

	it('keeps a resize inside the board and at least one cell', () => {
		expect(snappedSpan(2000, 9000, GRID, SMALL)).toEqual({
			columns: 4,
			rows: 12,
		});
		expect(snappedSpan(-50, 10, GRID, SMALL)).toEqual({ columns: 1, rows: 1 });
	});

	it('keeps a full-width widget full width while only its height changes', () => {
		expect(snappedSpan(524, 400, GRID, LARGE)).toEqual({
			columns: 12,
			rows: 3,
		});
		expect(snappedSpan(390, 260, GRID, LARGE)).toEqual({
			columns: 3,
			rows: 2,
		});
	});
});

describe('pack', () => {
	it('places each widget in the first cells it fits, filling holes left above', () => {
		expect(pack([MEDIUM, { columns: 3, rows: 1 }, SMALL, SMALL], 4)).toEqual({
			cells: [
				{ column: 0, row: 0 },
				{ column: 0, row: 1 },
				{ column: 2, row: 0 },
				{ column: 3, row: 0 },
			],
			rows: 2,
		});
	});

	it('fits a span wider than the board into the board', () => {
		expect(pack([LARGE, SMALL], 2)).toEqual({
			cells: [
				{ column: 0, row: 0 },
				{ column: 0, row: 2 },
			],
			rows: 3,
		});
	});
});

describe('dropIndex', () => {
	const others = [MEDIUM, MEDIUM, MEDIUM];

	it('moves a widget to the slot nearest to where it is held', () => {
		expect(dropIndex(others, MEDIUM, GRID, centreOf(2, 1, MEDIUM), 0)).toBe(3);
		expect(dropIndex(others, MEDIUM, GRID, centreOf(0, 0, MEDIUM), 3)).toBe(0);
	});

	it('keeps the slot it has until another one is clearly closer', () => {
		const between = { x: centreOf(0, 0, MEDIUM).x + STEP * 0.9, y: centreOf(0, 0, MEDIUM).y };
		expect(dropIndex(others, MEDIUM, GRID, between, 0)).toBe(0);
		const past = { x: centreOf(2, 0, MEDIUM).x, y: centreOf(2, 0, MEDIUM).y };
		expect(dropIndex(others, MEDIUM, GRID, past, 0)).toBe(1);
	});
});
