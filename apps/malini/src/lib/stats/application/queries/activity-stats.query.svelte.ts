import type { ActivityStats } from '$contract/stats';
import { activityAggregate } from '$lib/stats/infrastructure/aggregates/activity.aggregate.svelte';

export { activityStatsQuery };

class ActivityStatsQuery {
	public readonly data: ActivityStats | null = $derived(activityAggregate.activity);
}

const activityStatsQuery = new ActivityStatsQuery();
