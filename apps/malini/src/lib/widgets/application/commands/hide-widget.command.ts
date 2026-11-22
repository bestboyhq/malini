import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';
import { changeWidgetBoard } from './widget-board-change';

export { hideWidgetCommand };

function hideWidgetCommand(workstreamId: string, widgetId: string): void {
	changeWidgetBoard('Suggestion not hidden', () => widgetsService.hide({ workstreamId, widgetId }));
}
