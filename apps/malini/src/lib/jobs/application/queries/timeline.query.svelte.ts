import type { TimelineRecord } from '$contract/jobs';
import { timelineAggregate } from '$lib/jobs/infrastructure/aggregates/timeline.aggregate.svelte';

export { timelineQuery };

class TimelineQuery {
	public readonly data: TimelineRecord | null = $derived(timelineAggregate.record);
}

const timelineQuery = new TimelineQuery();
