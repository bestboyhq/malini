import type { WidgetData, WidgetRow, WidgetSize, WidgetState } from '$contract/widgets';
import { WIDGET_GAP } from './widget-grid';

export type WidgetHeadline = 'number' | 'ring' | 'status';

export type WidgetRowsLook = 'bars' | 'list';

export type WidgetLayout = Readonly<{
	headline: WidgetHeadline | null;
	status: WidgetState | null;
	caption: boolean;
	runs: readonly WidgetState[];
	rows: WidgetRowsLook | null;
	rowCount: number;
}>;

export type GalleryFit = Readonly<{ paged: boolean; cell: number }>;

export const GALLERY_GAP = 16;

export const GALLERY_MIN_CELL = 112;

export const GALLERY_MAX_CELL = 140;

const STRIP_RUNS: Readonly<Record<WidgetSize, number>> = { small: 10, medium: 20, large: 30 };

const EMPTY_LAYOUT: WidgetLayout = {
	headline: null,
	status: null,
	caption: false,
	runs: [],
	rows: null,
	rowCount: 0,
};

export function widgetLayout(data: WidgetData | null, size: WidgetSize): WidgetLayout {
	if (data === null) return EMPTY_LAYOUT;
	const headline = headlineOf(data);
	const status = data.state ?? data.history.at(-1) ?? null;
	const runs = headline === 'status' || size !== 'small' ? runsOf(data, STRIP_RUNS[size]) : [];
	const rows = data.rows.length === 0 ? null : data.rows.every(isBar) ? 'bars' : 'list';
	const rowCount =
		rows === null ? 0 : Math.min(data.rows.length, rowRoom(size, headline, runs.length > 0));
	return {
		headline,
		status,
		caption: data.caption !== null && (size !== 'medium' || rowCount === 0),
		runs,
		rows: rowCount === 0 ? null : rows,
		rowCount,
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

function rowRoom(size: WidgetSize, headline: WidgetHeadline | null, strip: boolean): number {
	if (size === 'small') return headline === null ? 3 : 0;
	if (size === 'medium') return headline === null ? 4 : strip ? 0 : 2;
	return (headline === null ? 9 : 6) - (strip ? 1 : 0);
}

function isBar(row: WidgetRow): boolean {
	return rowShare(row) !== null;
}
