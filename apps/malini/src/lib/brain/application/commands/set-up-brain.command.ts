import { toast } from '$hyper-ui/components/toast';
import { brainAggregate } from '$lib/brain/infrastructure/aggregates/brain.aggregate.svelte';
import { brainService } from '$lib/brain/infrastructure/services/brain.service';

export { setUpBrainCommand };

function setUpBrainCommand(sync: boolean = true): void {
	if (brainAggregate.settingUp) return;
	brainAggregate.settingUp = true;
	void (async () => {
		try {
			await brainAggregate.refresh(await brainService.setUp(sync));
		} catch (error) {
			toast.error(
				`Could not set up the brain · ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			brainAggregate.settingUp = false;
		}
	})();
}
