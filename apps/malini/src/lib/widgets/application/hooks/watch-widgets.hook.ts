import { untrack } from 'svelte';
import { loadWidgetBoardCommand } from '$lib/widgets/application/commands/load-widget-board.command';
import { widgetBoardsAggregate } from '$lib/widgets/infrastructure/aggregates/widget-boards.aggregate.svelte';
import { widgetsService } from '$lib/widgets/infrastructure/services/widgets.service';

export { watchWidgetsHook };

const watchers = new Map<string, () => void>();
const counts = new Map<string, number>();

function watchWidgetsHook(workstreamId: string): () => void {
	untrack(() => loadWidgetBoardCommand(workstreamId));
	counts.set(workstreamId, (counts.get(workstreamId) ?? 0) + 1);
	if (!watchers.has(workstreamId)) watchers.set(workstreamId, startWatching(workstreamId));
	return () => {
		const left = (counts.get(workstreamId) ?? 1) - 1;
		if (left > 0) {
			counts.set(workstreamId, left);
			return;
		}
		counts.delete(workstreamId);
		watchers.get(workstreamId)?.();
		watchers.delete(workstreamId);
	};
}

function startWatching(workstreamId: string): () => void {
	const watch = (): void => void widgetsService.watch(workstreamId, !document.hidden);
	watch();
	document.addEventListener('visibilitychange', watch);
	const stopReadings = widgetsService.onReadingChanged((reading) =>
		widgetBoardsAggregate.read(reading),
	);
	const stopBoards = widgetsService.onBoardChanged(({ board }) => {
		if (widgetBoardsAggregate.workstreamsOn(board).includes(workstreamId))
			loadWidgetBoardCommand(workstreamId);
	});
	return () => {
		document.removeEventListener('visibilitychange', watch);
		stopReadings();
		stopBoards();
		void widgetsService.watch(workstreamId, false);
	};
}
