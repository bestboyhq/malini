import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';
import { changeWidgetBoard } from './widget-board-change';

export { removeWidgetCommand };

function removeWidgetCommand(workstreamId: string, widgetId: string): void {
	changeWidgetBoard('Widget not removed', () => widgetsService.remove({ workstreamId, widgetId }));
}
