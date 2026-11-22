import { describe, expect, it } from 'vitest';
import { widgetGrid } from './widget-grid';

describe('widgetGrid', () => {
	it('keeps two columns on a narrow board', () => {
		expect(widgetGrid(200)).toEqual({ columns: 2, cell: 96 });
	});

	it('adds a column once a third fits at the minimum cell', () => {
		expect(widgetGrid(408)).toEqual({ columns: 3, cell: 130 });
	});
});
