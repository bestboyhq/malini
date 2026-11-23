import { lidHoldService } from '$lib/app/infrastructure/services/lid-hold.service';
import { lidHoldStore } from '$lib/app/infrastructure/stores/lid-hold.store.svelte';

export function loadLidHoldCommand(): void {
	void (async () => {
		try {
			const { on, available } = await lidHoldService.read();
			lidHoldStore.offer(available);
			lidHoldStore.set(on);
		} catch (error) {
			lidHoldStore.set(null);
			console.error('[malini app] could not read the lid setting', error);
		}
	})();
}
