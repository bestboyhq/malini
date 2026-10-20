import { resourcesAggregate } from '$lib/stats/infrastructure/aggregates/resources.aggregate.svelte';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

let watchers = 0;
let unsubscribe: (() => void) | null = null;

export function watchResourcesHook(): () => void {
	watchers += 1;
	unsubscribe ??= statsService.onResourcesSampled((sample) => resourcesAggregate.append(sample));

	let released = false;
	return () => {
		if (released) return;
		released = true;
		watchers -= 1;
		if (watchers > 0) return;
		unsubscribe?.();
		unsubscribe = null;
	};
}
