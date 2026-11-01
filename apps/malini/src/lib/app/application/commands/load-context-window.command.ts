import { contextWindowService } from '$lib/app/infrastructure/services/context-window.service';
import { contextWindowStore } from '$lib/app/infrastructure/stores/context-window.store.svelte';

export function loadContextWindowCommand(): void {
	void (async () => {
		try {
			contextWindowStore.replace(await contextWindowService.read());
		} catch (error) {
			console.error('[malini app] could not read the context window', error);
		}
	})();
}
