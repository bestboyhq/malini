import { widgetBoardsAggregate } from '$lib/widgets/infrastructure/aggregates/widget-boards.aggregate.svelte';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';

export { refreshWidgetCommand };

function refreshWidgetCommand(workstreamId: string, widgetId: string): void {
	void (async () => {
		try {
			widgetBoardsAggregate.read(await widgetsService.refresh({ workstreamId, widgetId }));
		} catch {
			return;
		}
	})();
}
