import { timelineAggregate } from '$lib/automations/infrastructure/aggregates/timeline.aggregate.svelte';

export { timelineErrorQuery };

class TimelineErrorQuery {
	public readonly data: string | null = $derived(timelineAggregate.error);
}

const timelineErrorQuery = new TimelineErrorQuery();
