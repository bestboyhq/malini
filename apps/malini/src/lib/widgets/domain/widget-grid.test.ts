import { describe, expect, it } from 'vitest';
import { widgetGrid, widgetSpan } from './widget-grid';

describe('widgetGrid', () => {
	it('keeps two columns on a narrow board', () => {
		expect(widgetGrid(200)).toEqual({ columns: 2, cell: 96 });
	});

	it('adds a column once a third fits at the minimum cell', () => {
		expect(widgetGrid(408)).toEqual({ columns: 3, cell: 130 });
	});
});

describe('widgetSpan', () => {
	it('spans every column for a large widget, so it fills a wide board', () => {
		expect(widgetSpan('large', 4)).toEqual({ columns: 4, rows: 2 });
		expect(widgetSpan('large', 2)).toEqual({ columns: 2, rows: 2 });
	});

	it('keeps small and medium at their own width on a wide board', () => {
		expect(widgetSpan('small', 4)).toEqual({ columns: 1, rows: 1 });
		expect(widgetSpan('medium', 4)).toEqual({ columns: 2, rows: 1 });
	});
});
