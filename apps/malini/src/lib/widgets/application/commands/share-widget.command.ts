import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';

export { shareWidgetCommand };

function shareWidgetCommand(workstreamId: string, widgetId: string): Promise<void> {
	return widgetsService.share({ workstreamId, widgetId });
}
