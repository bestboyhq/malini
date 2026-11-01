import { contextWindowService } from '$lib/app/infrastructure/services/context-window.service';
import { contextWindowStore } from '$lib/app/infrastructure/stores/context-window.store.svelte';

export function chooseContextWindowCommand(tokens: number): void {
	const previous = contextWindowStore.tokens;
	if (previous === null || tokens === previous) return;
	contextWindowStore.replace(tokens);
	void (async () => {
		try {
			await contextWindowService.write(tokens);
		} catch (error) {
			contextWindowStore.replace(previous);
			console.error('[malini app] could not save the context window', error);
		}
	})();
}
