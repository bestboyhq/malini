import { removed } from '$lib/widgets/domain/board-arrangement';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';
import { changeWidgetBoard } from './widget-board-change';

export { removeWidgetCommand };

function removeWidgetCommand(workstreamId: string, widgetId: string): void {
	changeWidgetBoard(
		workstreamId,
		'Widget not removed',
		(board) => removed(board, widgetId),
		() => widgetsService.remove({ workstreamId, widgetId }),
	);
}
