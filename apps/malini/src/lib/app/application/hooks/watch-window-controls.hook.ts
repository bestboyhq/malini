import { windowControlsService } from '$lib/app/infrastructure/services/window-controls.service';
import { windowControlsStore } from '$lib/app/infrastructure/stores/window-controls.store.svelte';

export function watchWindowControlsHook(): () => void {
	let announced = false;
	const stop = windowControlsService.onChange((state) => {
		announced = true;
		windowControlsStore.observe(state);
	});
	void (async () => {
		try {
			const state = await windowControlsService.current();
			if (!announced) windowControlsStore.observe(state);
		} catch (error) {
			console.error('[malini app] could not read the window controls', error);
		}
	})();
	return stop;
}
