import { resourcesAggregate } from '$lib/stats/infrastructure/aggregates/resources.aggregate.svelte';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

export function watchResourceBreakdownHook(): () => void {
	const load = (): void => {
		resourcesAggregate.loadBreakdown().catch((error: unknown) => {
			console.error('[malini stats] could not load the resource breakdown', error);
		});
	};
	load();
	return statsService.onResourcesSampled(load);
}
