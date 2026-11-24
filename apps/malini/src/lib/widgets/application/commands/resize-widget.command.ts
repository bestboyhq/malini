import type { WidgetSpan } from '$contract/widgets';
import { resized } from '$lib/widgets/domain/board-arrangement';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';
import { changeWidgetBoard } from './widget-board-change';

export { resizeWidgetCommand };

function resizeWidgetCommand(workstreamId: string, widgetId: string, span: WidgetSpan): void {
	changeWidgetBoard(
		workstreamId,
		'Widget not resized',
		(board) => resized(board, widgetId, span),
		() => widgetsService.resize({ workstreamId, widgetId, span }),
	);
}
