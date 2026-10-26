import { timelineAggregate } from '$lib/jobs/infrastructure/aggregates/timeline.aggregate.svelte';

export { timelineErrorQuery };

class TimelineErrorQuery {
	public readonly data: string | null = $derived(timelineAggregate.error);
}

const timelineErrorQuery = new TimelineErrorQuery();
