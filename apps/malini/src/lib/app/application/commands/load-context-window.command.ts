import { contextWindowService } from '$lib/app/infrastructure/services/context-window.service';
import { contextWindowStore } from '$lib/app/infrastructure/stores/context-window.store.svelte';

export function loadContextWindowCommand(): void {
	void (async () => {
		try {
			const { tokens, optimized } = await contextWindowService.read();
			contextWindowStore.replace(tokens);
			contextWindowStore.optimize(optimized);
		} catch (error) {
			console.error('[malini app] could not read the context window', error);
		}
	})();
}
