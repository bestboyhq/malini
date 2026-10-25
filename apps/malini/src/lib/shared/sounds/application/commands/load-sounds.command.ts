import { soundsService } from '$shared/sounds/infrastructure/services/sounds.service';
import { soundsStore } from '$shared/sounds/infrastructure/stores/sounds.store.svelte';

export function loadSoundsCommand(): void {
	void (async () => {
		try {
			soundsStore.loaded(await soundsService.load());
		} catch (error) {
			console.error('[malini sounds] could not read your sounds', error);
		}
	})();
}
