import type { WidgetSize } from '$contract/widgets';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';
import { changeWidgetBoard } from './widget-board-change';

export { resizeWidgetCommand };

function resizeWidgetCommand(workstreamId: string, widgetId: string, size: WidgetSize): void {
	changeWidgetBoard('Widget not resized', () =>
		widgetsService.resize({ workstreamId, widgetId, size }),
	);
}
