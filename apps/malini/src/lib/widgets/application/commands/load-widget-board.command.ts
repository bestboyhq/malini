import { widgetBoardsAggregate } from '$lib/widgets/infrastructure/aggregates/widget-boards.aggregate.svelte';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';

export { loadWidgetBoardCommand };

function loadWidgetBoardCommand(workstreamId: string): void {
	void (async () => {
		try {
			widgetBoardsAggregate.set(await widgetsService.board(workstreamId));
		} catch (error) {
			widgetBoardsAggregate.fail(
				workstreamId,
				error instanceof Error ? error.message : String(error),
			);
		}
	})();
}
