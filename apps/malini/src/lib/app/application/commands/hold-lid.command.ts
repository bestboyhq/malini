import { lidHoldService } from '$lib/app/infrastructure/services/lid-hold.service';
import { lidHoldStore } from '$lib/app/infrastructure/stores/lid-hold.store.svelte';

export function holdLidCommand(on: boolean): void {
	const previous = lidHoldStore.on;
	lidHoldStore.set(on);
	lidHoldStore.refuse(false);
	lidHoldStore.ask(true);
	void (async () => {
		try {
			lidHoldStore.set(await lidHoldService.write(on));
		} catch (error) {
			lidHoldStore.set(previous);
			lidHoldStore.refuse(true);
			console.error('[malini app] could not save the lid setting', error);
		} finally {
			lidHoldStore.ask(false);
		}
	})();
}
