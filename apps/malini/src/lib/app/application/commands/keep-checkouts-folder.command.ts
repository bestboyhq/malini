import { checkoutsFolderService } from '$lib/app/infrastructure/services/checkouts-folder.service';
import { checkoutsFolderStore } from '$lib/app/infrastructure/stores/checkouts-folder.store.svelte';

export function keepCheckoutsFolderCommand(): void {
	void (async () => {
		try {
			checkoutsFolderStore.folder = await checkoutsFolderService.keep();
		} catch (error) {
			console.error('[malini app] could not keep the checkouts folder', error);
		}
	})();
}
