import {
	WIDGET_HISTORY_MAX,
	type WidgetData,
	type WidgetRow,
	type WidgetSpan,
	type WidgetState,
} from '$contract/widgets';
import { WIDGET_GAP } from './widget-grid';

export type WidgetHeadline = 'number' | 'ring' | 'status';

export type WidgetRowsLook = 'bars' | 'list';

export type WidgetLayout = Readonly<{
	headline: WidgetHeadline | null;
	status: WidgetState | null;
	caption: boolean;
	runs: readonly WidgetState[];
	rows: WidgetRowsLook | null;
	rowColumns: number;
	chart: boolean;
	legend: boolean;
	side: boolean;
	hero: boolean;
}>;

export type GalleryFit = Readonly<{ paged: boolean; cell: number }>;

export const GALLERY_GAP = 16;

export const GALLERY_MIN_CELL = 112;

export const GALLERY_MAX_CELL = 140;

const RUNS_PER_COLUMN = 10;

const EMPTY_LAYOUT: WidgetLayout = {
	headline: null,
	status: null,
	caption: false,
	runs: [],
	rows: null,
	rowColumns: 1,
	chart: false,
	legend: false,
	side: false,
	hero: false,
};

export function widgetLayout(data: WidgetData | null, span: WidgetSpan): WidgetLayout {
	if (data === null) return EMPTY_LAYOUT;
	const single = span.columns === 1 && span.rows === 1;
	const headline = headlineOf(data);
	const chart = data.chart !== null;
	const runs =
		headline === 'status' || !single
			? runsOf(data, Math.min(WIDGET_HISTORY_MAX, span.columns * RUNS_PER_COLUMN))
			: [];
	const rows = chart || (single && headline !== null) ? null : rowsLook(data.rows);
	const side =
		span.columns > 1 &&
		span.rows === 1 &&
		(headline === 'number' || headline === 'ring') &&
		(chart || rows !== null);
	return {
		headline,
		status: data.state ?? data.history.at(-1) ?? null,
		caption: data.caption !== null && !(single && chart),
		runs,
		rows,
		rowColumns: rows !== null && !side && span.columns >= 3 ? 2 : 1,
		chart,
		legend: (data.chart?.series.length ?? 0) > 1 && span.rows > 1,
		side,
		hero: headline === 'number' && !chart && rows === null && runs.length === 0,
	};
}

export function gallerySizes(width: number): GalleryFit {
	const fit = Math.floor((width - 2 * GALLERY_GAP - 2 * WIDGET_GAP) / 5);
	const paged = fit < GALLERY_MIN_CELL;
	const cell = paged ? Math.floor((width - WIDGET_GAP) / 2) : fit;
	return { paged, cell: Math.max(0, Math.min(GALLERY_MAX_CELL, cell)) };
}

export function rowShare(row: WidgetRow): number | null {
	if (typeof row.value !== 'number' || row.max === null || row.max <= 0) return null;
	return Math.min(100, Math.max(0, (row.value / row.max) * 100));
}

function headlineOf(data: WidgetData): WidgetHeadline | null {
	if (data.value !== null) return 'number';
	if (data.percent !== null) return 'ring';
	if (data.state !== null || data.history.length > 0) return 'status';
	return null;
}

function runsOf(data: WidgetData, most: number): readonly WidgetState[] {
	if (data.history.length === 0) return [];
	const runs = data.state === null ? data.history : [...data.history, data.state];
	return runs.slice(-most);
}

function rowsLook(rows: readonly WidgetRow[]): WidgetRowsLook | null {
	if (rows.length === 0) return null;
	return rows.every((row) => rowShare(row) !== null) ? 'bars' : 'list';
}
