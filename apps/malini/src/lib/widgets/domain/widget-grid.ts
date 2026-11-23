import {
	WIDGET_SIZES,
	WIDGET_SIZE_SPANS,
	WIDGET_SPAN_MAX,
	type WidgetSize,
	type WidgetSpan,
} from '$contract/widgets';

export type WidgetGrid = Readonly<{ columns: number; cell: number }>;

export const WIDGET_GAP = 8;

export const WIDGET_MIN_CELL = 124;

export const WIDGET_MIN_COLUMNS = 2;

export function widgetGrid(width: number): WidgetGrid {
	const columns = Math.max(
		WIDGET_MIN_COLUMNS,
		Math.floor((width + WIDGET_GAP) / (WIDGET_MIN_CELL + WIDGET_GAP)),
	);
	return { columns, cell: Math.floor((width - WIDGET_GAP * (columns - 1)) / columns) };
}

export function shownSpan(span: WidgetSpan, columns: number): WidgetSpan {
	return { columns: Math.min(span.columns, columns), rows: span.rows };
}

export function spanLook({ columns, rows }: WidgetSpan): WidgetSize {
	if (columns === 1) return 'small';
	return rows === 1 ? 'medium' : 'large';
}

export function presetOf(span: WidgetSpan, columns: number): WidgetSize | null {
	const shown = shownSpan(span, columns);
	return (
		WIDGET_SIZES.find((size) => sameSpan(shownSpan(WIDGET_SIZE_SPANS[size], columns), shown)) ??
		null
	);
}

export function sameSpan(one: WidgetSpan, other: WidgetSpan): boolean {
	return one.columns === other.columns && one.rows === other.rows;
}

export function snappedSpan(
	width: number,
	height: number,
	grid: WidgetGrid,
	from: WidgetSpan,
): WidgetSpan {
	const step = grid.cell + WIDGET_GAP;
	const columns = within(Math.round((width + WIDGET_GAP) / step), grid.columns);
	const rows = within(Math.round((height + WIDGET_GAP) / step), WIDGET_SPAN_MAX);
	const full = columns === grid.columns && from.columns >= grid.columns;
	return { columns: full ? from.columns : columns, rows };
}

function within(count: number, most: number): number {
	return Math.min(most, Math.max(1, count));
}
