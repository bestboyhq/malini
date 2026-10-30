import { momentAggregate } from '$lib/stats/infrastructure/aggregates/moment.aggregate.svelte';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';
import { momentsStore } from '$lib/stats/infrastructure/stores/moments.store.svelte';

export function watchMomentHook(): () => void {
	momentsStore.hydrate();
	const load = (): void => {
		momentAggregate.load().catch((error: unknown) => {
			console.error('[malini stats] could not look for a milestone', error);
		});
	};
	load();
	return statsService.onTurnFinished(load);
}
