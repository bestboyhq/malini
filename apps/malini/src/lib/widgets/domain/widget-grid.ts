import type { WidgetSize } from '$contract/widgets';

export type WidgetSpan = Readonly<{ columns: number; rows: number }>;

export type WidgetGrid = Readonly<{ columns: number; cell: number }>;

export const WIDGET_GAP = 8;

export const WIDGET_MIN_CELL = 124;

export const WIDGET_MIN_COLUMNS = 2;

export const WIDGET_SPANS: Readonly<Record<WidgetSize, WidgetSpan>> = {
	small: { columns: 1, rows: 1 },
	medium: { columns: 2, rows: 1 },
	large: { columns: 2, rows: 2 },
};

export function widgetGrid(width: number): WidgetGrid {
	const columns = Math.max(
		WIDGET_MIN_COLUMNS,
		Math.floor((width + WIDGET_GAP) / (WIDGET_MIN_CELL + WIDGET_GAP)),
	);
	return { columns, cell: Math.floor((width - WIDGET_GAP * (columns - 1)) / columns) };
}
