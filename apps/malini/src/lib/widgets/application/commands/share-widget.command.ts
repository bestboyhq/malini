import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';

export { shareWidgetCommand };

function shareWidgetCommand(workstreamId: string, widgetId: string, into: string): Promise<void> {
	return widgetsService.share({ workstreamId, widgetId, into });
}
