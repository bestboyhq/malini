import type { WidgetSpan } from '$contract/widgets';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';
import { changeWidgetBoard } from './widget-board-change';

export { resizeWidgetCommand };

function resizeWidgetCommand(workstreamId: string, widgetId: string, span: WidgetSpan): void {
	changeWidgetBoard('Widget not resized', () =>
		widgetsService.resize({ workstreamId, widgetId, span }),
	);
}
