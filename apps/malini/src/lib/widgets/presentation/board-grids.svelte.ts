import { WIDGET_GAP, widgetGrid, type WidgetGrid } from '$lib/widgets/domain/widget-grid';

let boards: Readonly<Record<string, WidgetGrid>> = $state.raw({});

export function showBoardGrid(workstreamId: string, grid: WidgetGrid): void {
	const shown = boards[workstreamId];
	if (shown?.columns === grid.columns && shown.cell === grid.cell) return;
	boards = { ...boards, [workstreamId]: grid };
}

export function cardGrid(workstreamId: string, width: number): WidgetGrid {
	const board = boards[workstreamId];
	if (board === undefined || board.columns * (board.cell + WIDGET_GAP) - WIDGET_GAP > width)
		return widgetGrid(width);
	return board;
}
