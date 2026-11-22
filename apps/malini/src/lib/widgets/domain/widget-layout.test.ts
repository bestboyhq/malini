import { describe, expect, it } from 'vitest';
import { parseWidgetData, type WidgetData } from '$contract/widgets';
import { gallerySizes, rowShare, widgetLayout } from './widget-layout';

function data(fields: Readonly<Record<string, unknown>>): WidgetData {
	const parsed = parseWidgetData(fields);
	if (parsed === null) throw new Error('fixture is not widget data');
	return parsed;
}

const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({ label: `Row ${value}`, value }));

describe('widgetLayout', () => {
	it('draws nothing without data', () => {
		expect(widgetLayout(null, 'large')).toMatchObject({ headline: null, rows: null, rowCount: 0 });
	});

	it('leads with the number and keeps rows off a small tile', () => {
		const layout = widgetLayout(data({ value: 42, caption: 'Open', rows: ROWS }), 'small');
		expect(layout).toMatchObject({ headline: 'number', caption: true, rows: null, rowCount: 0 });
	});

	it('trades the caption for two rows on a medium tile', () => {
		const layout = widgetLayout(data({ value: 42, caption: 'Open', rows: ROWS }), 'medium');
		expect(layout).toMatchObject({ caption: false, rows: 'list', rowCount: 2 });
	});

	it('falls back to a ring, then to a status', () => {
		expect(widgetLayout(data({ percent: 64 }), 'small').headline).toBe('ring');
		expect(widgetLayout(data({ history: ['failure'] }), 'small')).toMatchObject({
			headline: 'status',
			status: 'failure',
		});
	});

	it('ends the runs strip with the current state and keeps the newest runs', () => {
		const history = Array.from({ length: 12 }, () => 'success');
		const layout = widgetLayout(data({ state: 'failure', history }), 'small');
		expect(layout.runs).toHaveLength(10);
		expect(layout.runs.at(-1)).toBe('failure');
	});

	it('gives a large tile one row less for its strip', () => {
		const layout = widgetLayout(data({ value: 3, history: ['success'], rows: ROWS }), 'large');
		expect(layout.rowCount).toBe(5);
	});

	it('draws bars only when every row has a share', () => {
		const bars = [{ label: 'CPU', value: 3, max: 4 }];
		expect(widgetLayout(data({ rows: bars }), 'medium').rows).toBe('bars');
		expect(widgetLayout(data({ rows: [...bars, { label: 'Up' }] }), 'medium').rows).toBe('list');
	});
});

describe('rowShare', () => {
	it('clamps the share and skips rows without a max', () => {
		const row = data({
			rows: [
				{ label: 'A', value: 9, max: 4 },
				{ label: 'B', value: 1 },
			],
		}).rows;
		expect(row.map(rowShare)).toEqual([100, null]);
	});
});

describe('gallerySizes', () => {
	it('puts the three sizes side by side when a cell fits', () => {
		expect(gallerySizes(700)).toEqual({ paged: false, cell: 130 });
		expect(gallerySizes(900)).toEqual({ paged: false, cell: 140 });
	});

	it('shows one size at a time on a narrow card', () => {
		expect(gallerySizes(200)).toEqual({ paged: true, cell: 96 });
		expect(gallerySizes(0)).toEqual({ paged: true, cell: 0 });
	});
});
