import { updatesService } from '$lib/app/infrastructure/services/updates.service';
import { stagedUpdateStore } from '$lib/app/infrastructure/stores/staged-update.store.svelte';

export function restartToUpdateCommand(): void {
	if (stagedUpdateStore.restarting) return;
	stagedUpdateStore.setRestarting(true);

	void (async () => {
		try {
			await updatesService.restart();
		} catch (error) {
			stagedUpdateStore.setRestarting(false);
			console.error('[malini updates] could not restart to install the update', error);
		}
	})();
}
