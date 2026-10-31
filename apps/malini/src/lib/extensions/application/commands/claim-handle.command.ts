import { publishingAggregate } from '$lib/extensions/infrastructure/aggregates/publishing.aggregate.svelte';
import { marketplaceService } from '$lib/extensions/infrastructure/services/marketplace.service';
import { handleClaimsStore } from '$lib/extensions/infrastructure/stores/handle-claims.store.svelte';

export { claimHandleCommand };

function claimHandleCommand(handle: string): void {
	handleClaimsStore.start();
	void (async () => {
		try {
			const problem = await marketplaceService.claimHandle(handle);
			handleClaimsStore.finish(problem);
			if (problem === null) publishingAggregate.replace(await marketplaceService.publishing());
		} catch (error) {
			handleClaimsStore.finish(error instanceof Error ? error.message : String(error));
		}
	})();
}
