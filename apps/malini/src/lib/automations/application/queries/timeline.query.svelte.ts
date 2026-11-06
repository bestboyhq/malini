import type { TimelineRecord } from '$contract/automations';
import { timelineAggregate } from '$lib/automations/infrastructure/aggregates/timeline.aggregate.svelte';

export { timelineQuery };

class TimelineQuery {
	public readonly data: TimelineRecord | null = $derived(timelineAggregate.record);
}

const timelineQuery = new TimelineQuery();
