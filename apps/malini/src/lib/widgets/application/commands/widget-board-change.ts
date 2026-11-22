import type { WidgetBoard } from '$contract/widgets';
import { toast } from '$hyper-ui/components/toast';
import { widgetBoardsAggregate } from '$lib/widgets/infrastructure/aggregates/widget-boards.aggregate.svelte';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { changeWidgetBoard };

function changeWidgetBoard(failure: string, change: () => Promise<WidgetBoard>): void {
	void (async () => {
		try {
			widgetBoardsAggregate.set(await change());
		} catch (error) {
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			toast.error(`${failure}${detail ? ` · ${detail}` : ''}.`);
		}
	})();
}
