import { activityAggregate } from '$lib/stats/infrastructure/aggregates/activity.aggregate.svelte';

export { loadActivityCommand };

function loadActivityCommand(): void {
	void (async () => {
		try {
			await activityAggregate.load();
		} catch (error) {
			console.error('[malini stats] could not load activity', error);
		}
	})();
}
