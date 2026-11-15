import { compactOutputService } from '$lib/app/infrastructure/services/compact-output.service';
import { compactOutputStore } from '$lib/app/infrastructure/stores/compact-output.store.svelte';

export function loadCompactOutputCommand(): void {
	void (async () => {
		try {
			compactOutputStore.set(await compactOutputService.read());
		} catch (error) {
			compactOutputStore.set(null);
			console.error('[malini app] could not read the compact output setting', error);
		}
	})();
}
