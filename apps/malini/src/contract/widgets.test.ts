import { describe, expect, it } from 'vitest';
import {
	WIDGET_CHART_POINTS_MAX,
	WIDGET_CHART_SERIES_MAX,
	parseWidgetData,
	type WidgetChart,
} from './widgets';

function chartOf(chart: unknown): WidgetChart | null {
	const data = parseWidgetData({ chart });
	if (data === null) throw new Error('fixture is not widget data');
	return data.chart;
}

describe('parseWidgetData chart', () => {
	it('reads a line chart with its labels and series', () => {
		expect(
			chartOf({
				kind: 'line',
				labels: ['18 Nov', '19 Nov'],
				series: [
					{ label: 'Visits', values: [12, 30] },
					{ label: 'Sign-ups', values: [3, 7] },
				],
			}),
		).toEqual({
			kind: 'line',
			labels: ['18 Nov', '19 Nov'],
			series: [
				{ label: 'Visits', values: [12, 30] },
				{ label: 'Sign-ups', values: [3, 7] },
			],
		});
	});

	it('turns values that are not finite numbers into gaps', () => {
		const chart = chartOf({ kind: 'bar', series: [{ values: [1, null, 'x', Infinity, 4] }] });
		expect(chart?.series).toEqual([{ label: null, values: [1, null, null, null, 4] }]);
		expect(chart?.labels).toEqual([]);
	});

	it('keeps the first series and the last points', () => {
		const values = Array.from({ length: WIDGET_CHART_POINTS_MAX + 5 }, (_, index) => index);
		const labels = values.map(String);
		const series = Array.from({ length: WIDGET_CHART_SERIES_MAX + 2 }, () => ({ values }));
		const chart = chartOf({ kind: 'line', labels, series });
		expect(chart?.series).toHaveLength(WIDGET_CHART_SERIES_MAX);
		expect(chart?.series[0]?.values).toHaveLength(WIDGET_CHART_POINTS_MAX);
		expect(chart?.series[0]?.values[0]).toBe(5);
		expect(chart?.labels[0]).toBe('5');
		expect(chart?.labels).toHaveLength(WIDGET_CHART_POINTS_MAX);
	});

	it('takes labels shorter than the points and drops labels past them', () => {
		expect(chartOf({ kind: 'bar', labels: ['EU'], series: [{ values: [1, 2] }] })?.labels).toEqual([
			'EU',
		]);
		expect(
			chartOf({ kind: 'bar', labels: ['EU', 'US', 'APAC', 7], series: [{ values: [1, 2] }] })
				?.labels,
		).toEqual(['EU', 'US']);
	});

	it('drops a chart with an unknown kind, no series or no points', () => {
		expect(chartOf({ kind: 'pie', series: [{ values: [1] }] })).toBeNull();
		expect(chartOf({ kind: 'line', series: [] })).toBeNull();
		expect(chartOf({ kind: 'line', series: [{ values: [] }, { label: 'A' }] })).toBeNull();
		expect(chartOf({ kind: 'line', series: [{ values: [null, 'x'] }] })).toBeNull();
		expect(chartOf('line')).toBeNull();
		expect(parseWidgetData({ value: 3 })?.chart).toBeNull();
	});
});
