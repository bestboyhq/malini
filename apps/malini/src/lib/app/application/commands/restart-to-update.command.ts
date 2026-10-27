import { updatesService } from '$lib/app/infrastructure/services/updates.service';
import { updateStatusStore } from '$lib/app/infrastructure/stores/update-status.store.svelte';

export function restartToUpdateCommand(): void {
	if (updateStatusStore.restarting) return;
	updateStatusStore.setRestarting(true);

	void (async () => {
		try {
			await updatesService.restart();
		} catch (error) {
			updateStatusStore.setRestarting(false);
			console.error('[malini updates] could not restart to install the update', error);
		}
	})();
}
