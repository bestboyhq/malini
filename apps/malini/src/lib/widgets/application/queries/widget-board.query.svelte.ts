import type { WidgetBoard, WidgetReading } from '$contract/widgets';
import { widgetBoardsAggregate } from '$lib/widgets/infrastructure/aggregates/widget-boards.aggregate.svelte';

export { widgetBoardQuery };

class WidgetBoardQuery {
	public readonly data: (workstreamId: string) => WidgetBoard | null = $derived(
		(workstreamId: string) => widgetBoardsAggregate.boards[workstreamId] ?? null,
	);
	public readonly error: (workstreamId: string) => string | null = $derived(
		(workstreamId: string) => widgetBoardsAggregate.errors[workstreamId] ?? null,
	);
	public readonly reading: (workstreamId: string, widgetId: string) => WidgetReading | null =
		$derived(
			(workstreamId: string, widgetId: string) =>
				widgetBoardsAggregate.boards[workstreamId]?.readings.find(
					(reading) => reading.widgetId === widgetId,
				) ?? null,
		);
}

const widgetBoardQuery = new WidgetBoardQuery();
