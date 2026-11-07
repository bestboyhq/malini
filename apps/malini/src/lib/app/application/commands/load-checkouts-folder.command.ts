import { checkoutsFolderService } from '$lib/app/infrastructure/services/checkouts-folder.service';
import { checkoutsFolderStore } from '$lib/app/infrastructure/stores/checkouts-folder.store.svelte';

export function loadCheckoutsFolderCommand(): void {
	void (async () => {
		try {
			checkoutsFolderStore.folder = await checkoutsFolderService.read();
		} catch (error) {
			console.error('[malini app] could not read the checkouts folder', error);
		}
	})();
}
