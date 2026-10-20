import { workstreamRunningAggregate } from '$lib/stats/infrastructure/aggregates/workstream-running.aggregate.svelte';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

export { watchWorkstreamRunningHook };

let watchers = 0;
let unsubscribe: (() => void) | null = null;

function watchWorkstreamRunningHook(): () => void {
	watchers += 1;
	if (!unsubscribe) {
		unsubscribe = statsService.onWorkstreamRunningChanged((running) =>
			workstreamRunningAggregate.replace(running),
		);
		workstreamRunningAggregate.load().catch((error: unknown) => {
			console.error('[malini stats] could not load what keeps running', error);
		});
	}

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
