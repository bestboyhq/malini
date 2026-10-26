import { timelineAggregate } from '$lib/jobs/infrastructure/aggregates/timeline.aggregate.svelte';

export { loadTimelineCommand };

const HOUR_MS = 60 * 60 * 1_000;

function loadTimelineCommand(hours: number): void {
	void timelineAggregate.load(new Date(Date.now() - hours * HOUR_MS).toISOString());
}
