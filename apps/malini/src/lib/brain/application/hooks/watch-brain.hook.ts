import { brainAggregate } from '$lib/brain/infrastructure/aggregates/brain.aggregate.svelte';
import { brainService } from '$lib/brain/infrastructure/services/brain.service';

let watchers = 0;
let unsubscribe: (() => void) | null = null;

export function watchBrainHook(): () => void {
	watchers += 1;
	unsubscribe ??= brainService.onChanged((status) => {
		void (async () => {
			try {
				await brainAggregate.refresh(status);
			} catch (error) {
				console.error('[malini brain] could not refresh the brain', error);
			}
		})();
	});

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
