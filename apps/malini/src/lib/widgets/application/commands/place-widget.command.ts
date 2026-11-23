import type { WidgetSpan } from '$contract/widgets';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';
import { changeWidgetBoard } from './widget-board-change';

export { placeWidgetCommand };

function placeWidgetCommand(
	workstreamId: string,
	widgetId: string,
	index: number | null = null,
	span: WidgetSpan | null = null,
): void {
	changeWidgetBoard('Widget not placed', () =>
		widgetsService.place({ workstreamId, widgetId, index, span }),
	);
}
