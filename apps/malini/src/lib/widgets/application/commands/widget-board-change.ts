import type { WidgetBoard } from '$contract/widgets';
import { toast } from '$hyper-ui/components/toast';
import { widgetBoardsAggregate } from '$lib/widgets/infrastructure/aggregates/widget-boards.aggregate.svelte';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';
import { loadWidgetBoardCommand } from './load-widget-board.command';

export { changeWidgetBoard };

function changeWidgetBoard(
	workstreamId: string,
	failure: string,
	shown: (board: WidgetBoard) => WidgetBoard,
	change: () => Promise<WidgetBoard>,
): void {
	widgetBoardsAggregate.arrange(workstreamId, shown);
	void (async () => {
		try {
			widgetBoardsAggregate.settle(workstreamId, await change());
		} catch (error) {
			if (widgetBoardsAggregate.settle(workstreamId, null)) loadWidgetBoardCommand(workstreamId);
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			toast.error(`${failure}${detail ? ` · ${detail}` : ''}.`);
		}
	})();
}
