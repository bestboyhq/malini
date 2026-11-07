import { toast } from '$hyper-ui/components/toast';
import { brainAggregate } from '$lib/brain/infrastructure/aggregates/brain.aggregate.svelte';
import { brainService } from '$lib/brain/infrastructure/services/brain.service';

export { setBrainSyncCommand };

function setBrainSyncCommand(sync: boolean): void {
	if (brainAggregate.syncing) return;
	brainAggregate.syncing = true;
	void (async () => {
		try {
			brainAggregate.status = await brainService.setSync(sync);
		} catch (error) {
			toast.error(
				`Could not change sync · ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			brainAggregate.syncing = false;
		}
	})();
}
