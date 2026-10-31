import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';
import { handleClaimsStore } from '$lib/extensions/infrastructure/stores/handle-claims.store.svelte';

export { signInToPublishCommand };

function signInToPublishCommand(): void {
	handleClaimsStore.finish(null);
	void (async () => {
		try {
			await marketplaceService.signIn();
		} catch (error) {
			handleClaimsStore.finish(error instanceof Error ? error.message : String(error));
		}
	})();
}
