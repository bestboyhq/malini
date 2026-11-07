import { lidHoldService } from '$lib/app/infrastructure/services/lid-hold.service';
import { lidHoldStore } from '$lib/app/infrastructure/stores/lid-hold.store.svelte';

export function loadLidHoldCommand(): void {
	void (async () => {
		try {
			lidHoldStore.set(await lidHoldService.read());
		} catch (error) {
			lidHoldStore.set(null);
			console.error('[malini app] could not read the lid setting', error);
		}
	})();
}
