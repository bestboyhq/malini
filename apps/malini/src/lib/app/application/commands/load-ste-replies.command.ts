import { steRepliesService } from '$lib/app/infrastructure/services/ste-replies.service';
import { steRepliesStore } from '$lib/app/infrastructure/stores/ste-replies.store.svelte';

export function loadSteRepliesCommand(): void {
	void (async () => {
		try {
			steRepliesStore.set(await steRepliesService.read());
		} catch (error) {
			steRepliesStore.set(null);
			console.error('[malini app] could not read the STE replies setting', error);
		}
	})();
}
