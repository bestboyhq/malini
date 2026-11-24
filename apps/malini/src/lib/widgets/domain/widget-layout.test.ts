import { describe, expect, it } from 'vitest';
import { parseWidgetData, type WidgetData, type WidgetSpan } from '$contract/widgets';
import { gallerySizes, rowShare, widgetLayout } from './widget-layout';

function data(fields: Readonly<Record<string, unknown>>): WidgetData {
	const parsed = parseWidgetData(fields);
	if (parsed === null) throw new Error('fixture is not widget data');
	return parsed;
}

const SMALL: WidgetSpan = { columns: 1, rows: 1 };
const WIDE: WidgetSpan = { columns: 2, rows: 1 };
const FULL: WidgetSpan = { columns: 4, rows: 1 };
const TALL: WidgetSpan = { columns: 1, rows: 2 };
const LARGE: WidgetSpan = { columns: 4, rows: 3 };

const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({ label: `Row ${value}`, value }));

const CHART = {
	kind: 'line',
	series: [
		{ label: 'Visits', values: [1, 2, 3] },
		{ label: 'Sign-ups', values: [0, 1, 1] },
	],
};

describe('widgetLayout', () => {
	it('draws nothing without data', () => {
		expect(widgetLayout(null, LARGE)).toMatchObject({ headline: null, rows: null, chart: false });
	});

	it('lets a lone number fill the tile and keeps rows off a small tile', () => {
		expect(widgetLayout(data({ value: 42 }), SMALL)).toMatchObject({ hero: true, caption: false });
		expect(widgetLayout(data({ value: 42, caption: 'Open', rows: ROWS }), SMALL)).toMatchObject({
			headline: 'number',
			caption: true,
			rows: null,
			hero: true,
		});
	});

	it('puts the number beside its rows on a wide short tile', () => {
		expect(widgetLayout(data({ value: 42, caption: 'Open', rows: ROWS }), WIDE)).toMatchObject({
			caption: true,
			rows: 'list',
			side: true,
			rowColumns: 1,
		});
		expect(widgetLayout(data({ value: 42, rows: ROWS }), TALL).side).toBe(false);
	});

	it('splits rows in two columns on a wide tall tile', () => {
		expect(widgetLayout(data({ rows: ROWS }), LARGE).rowColumns).toBe(2);
		expect(widgetLayout(data({ rows: ROWS }), FULL).rowColumns).toBe(2);
		expect(widgetLayout(data({ rows: ROWS }), WIDE).rowColumns).toBe(1);
	});

	it('falls back to a ring, then to a status', () => {
		expect(widgetLayout(data({ percent: 64 }), SMALL).headline).toBe('ring');
		expect(widgetLayout(data({ history: ['failure'] }), SMALL)).toMatchObject({
			headline: 'status',
			status: 'failure',
		});
	});

	it('ends the runs strip with the current state and keeps more runs on wider tiles', () => {
		const history = Array.from({ length: 30 }, () => 'success');
		const runs = (span: WidgetSpan): number =>
			widgetLayout(data({ state: 'failure', history }), span).runs.length;
		expect(widgetLayout(data({ state: 'failure', history }), SMALL).runs.at(-1)).toBe('failure');
		expect([runs(SMALL), runs(WIDE), runs(FULL)]).toEqual([10, 20, 30]);
	});

	it('draws a chart in place of rows, with a legend for more than one series on tall tiles', () => {
		const chart = data({ value: 3, caption: 'This week', rows: ROWS, chart: CHART });
		expect(widgetLayout(chart, SMALL)).toMatchObject({
			chart: true,
			rows: null,
			caption: false,
			legend: false,
			hero: false,
		});
		expect(widgetLayout(chart, WIDE)).toMatchObject({ side: true, legend: false, caption: true });
		expect(widgetLayout(chart, LARGE)).toMatchObject({ side: false, legend: true });
		expect(widgetLayout(data({ chart: CHART }), WIDE)).toMatchObject({ side: false });
	});

	it('draws bars only when every row has a share', () => {
		const bars = [{ label: 'CPU', value: 3, max: 4 }];
		expect(widgetLayout(data({ rows: bars }), WIDE).rows).toBe('bars');
		expect(widgetLayout(data({ rows: [...bars, { label: 'Up' }] }), WIDE).rows).toBe('list');
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
