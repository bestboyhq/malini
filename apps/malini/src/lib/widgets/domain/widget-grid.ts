import { WIDGET_SPAN_MAX, type WidgetSize, type WidgetSpan } from '$contract/widgets';

export type WidgetGrid = Readonly<{ columns: number; cell: number }>;

export type GridCell = Readonly<{ column: number; row: number }>;

export type Packed = Readonly<{ cells: readonly GridCell[]; rows: number }>;

export type GridPoint = Readonly<{ x: number; y: number }>;

export const WIDGET_GAP = 8;

export const WIDGET_MIN_CELL = 124;

export const WIDGET_MIN_COLUMNS = 2;

const SWITCH_SHARE = 0.3;

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

export function pack(spans: readonly WidgetSpan[], columns: number): Packed {
	const taken: boolean[][] = [];
	let rows = 0;
	const cells = spans.map((each) => {
		const span = shownSpan(each, columns);
		for (let row = 0; ; row += 1) {
			for (let column = 0; column + span.columns <= columns; column += 1) {
				if (!fits(taken, column, row, span)) continue;
				for (let y = row; y < row + span.rows; y += 1) {
					const line = (taken[y] ??= []);
					for (let x = column; x < column + span.columns; x += 1) line[x] = true;
				}
				rows = Math.max(rows, row + span.rows);
				return { column, row };
			}
		}
	});
	return { cells, rows };
}

export function dropIndex(
	others: readonly WidgetSpan[],
	dragged: WidgetSpan,
	grid: WidgetGrid,
	centre: GridPoint,
	current: number,
): number {
	const step = grid.cell + WIDGET_GAP;
	const span = shownSpan(dragged, grid.columns);
	const distance = (index: number): number => {
		const cell = pack(inserted(others, index, dragged), grid.columns).cells[index];
		if (cell === undefined) return Number.POSITIVE_INFINITY;
		return Math.hypot(
			cell.column * step + (span.columns * step - WIDGET_GAP) / 2 - centre.x,
			cell.row * step + (span.rows * step - WIDGET_GAP) / 2 - centre.y,
		);
	};
	let best = current;
	let nearest = distance(current);
	const kept = nearest - step * SWITCH_SHARE;
	for (let index = 0; index <= others.length; index += 1) {
		const away = distance(index);
		const closer = away < nearest || (away === nearest && gap(index, current) < gap(best, current));
		if (index !== current && away < kept && closer) {
			best = index;
			nearest = away;
		}
	}
	return best;
}

export function inserted<T>(list: readonly T[], index: number, item: T): readonly T[] {
	return [...list.slice(0, index), item, ...list.slice(index)];
}

function gap(one: number, other: number): number {
	return Math.abs(one - other);
}

function fits(
	taken: readonly (readonly boolean[])[],
	column: number,
	row: number,
	span: WidgetSpan,
): boolean {
	for (let y = row; y < row + span.rows; y += 1) {
		for (let x = column; x < column + span.columns; x += 1) if (taken[y]?.[x]) return false;
	}
	return true;
}

function within(count: number, most: number): number {
	return Math.min(most, Math.max(1, count));
}
