import { contextWindowService } from '$lib/app/infrastructure/services/context-window.service';
import { contextWindowStore } from '$lib/app/infrastructure/stores/context-window.store.svelte';

export function optimizeContextCommand(optimized: boolean): void {
	const previous = contextWindowStore.optimized;
	if (previous === null || optimized === previous) return;
	contextWindowStore.optimize(optimized);
	void (async () => {
		try {
			await contextWindowService.optimize(optimized);
		} catch (error) {
			contextWindowStore.optimize(previous);
			console.error('[malini app] could not save the optimize context setting', error);
		}
	})();
}
