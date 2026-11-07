import { checkoutsFolderService } from '$lib/app/infrastructure/services/checkouts-folder.service';
import { checkoutsFolderStore } from '$lib/app/infrastructure/stores/checkouts-folder.store.svelte';

export function chooseCheckoutsFolderCommand(): void {
	if (checkoutsFolderStore.choosing) return;
	checkoutsFolderStore.choosing = true;
	void (async () => {
		try {
			checkoutsFolderStore.folder = await checkoutsFolderService.choose();
		} catch (error) {
			console.error('[malini app] could not choose the checkouts folder', error);
		} finally {
			checkoutsFolderStore.choosing = false;
		}
	})();
}
