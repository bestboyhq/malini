import { placedAt } from '$lib/widgets/domain/board-arrangement';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';
import { changeWidgetBoard } from './widget-board-change';

export { placeWidgetCommand };

function placeWidgetCommand(workstreamId: string, widgetId: string, index: number): void {
	changeWidgetBoard(
		workstreamId,
		'Widget not placed',
		(board) => placedAt(board, widgetId, index),
		() => widgetsService.place({ workstreamId, widgetId, index }),
	);
}
