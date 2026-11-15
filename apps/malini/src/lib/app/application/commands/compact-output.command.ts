import { compactOutputService } from '$lib/app/infrastructure/services/compact-output.service';
import { compactOutputStore } from '$lib/app/infrastructure/stores/compact-output.store.svelte';

export function compactOutputCommand(on: boolean): void {
	const previous = compactOutputStore.on;
	compactOutputStore.set(on);
	void (async () => {
		try {
			await compactOutputService.write(on);
		} catch (error) {
			compactOutputStore.set(previous);
			console.error('[malini app] could not save the compact output setting', error);
		}
	})();
}
