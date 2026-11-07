import { steRepliesService } from '$lib/app/infrastructure/services/ste-replies.service';
import { steRepliesStore } from '$lib/app/infrastructure/stores/ste-replies.store.svelte';

export function steRepliesCommand(on: boolean): void {
	const previous = steRepliesStore.on;
	steRepliesStore.set(on);
	void (async () => {
		try {
			await steRepliesService.write(on);
		} catch (error) {
			steRepliesStore.set(previous);
			console.error('[malini app] could not save the STE replies setting', error);
		}
	})();
}
