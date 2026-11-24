import {
	PLAN_WIDGET_SPAN,
	WIDGET_DEFAULT_SPAN,
	type WidgetBoard,
	type WidgetSpan,
} from '$contract/widgets';
import { inserted } from './widget-grid';

export function placedAt(board: WidgetBoard, widgetId: string, index: number): WidgetBoard {
	const current = board.placements.find((placement) => placement.widgetId === widgetId);
	const plan = board.widgets.some(({ id, origin }) => id === widgetId && origin === 'plan');
	const span = current?.span ?? (plan ? PLAN_WIDGET_SPAN : WIDGET_DEFAULT_SPAN);
	const others = board.placements.filter((placement) => placement.widgetId !== widgetId);
	return { ...board, placements: inserted(others, index, { widgetId, span }) };
}

export function resized(board: WidgetBoard, widgetId: string, span: WidgetSpan): WidgetBoard {
	return {
		...board,
		placements: board.placements.map((placement) =>
			placement.widgetId === widgetId ? { widgetId, span } : placement,
		),
	};
}

export function removed(board: WidgetBoard, widgetId: string): WidgetBoard {
	return {
		...board,
		widgets: board.widgets.filter(({ id, origin }) => id !== widgetId || origin !== 'mine'),
		placements: board.placements.filter((placement) => placement.widgetId !== widgetId),
	};
}

export function unplaced(board: WidgetBoard): WidgetBoard['widgets'] {
	const placed = new Set(board.placements.map(({ widgetId }) => widgetId));
	return board.widgets.filter(({ id }) => !placed.has(id));
}
