import { toast } from '$hyper-ui/components/toast';
import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

export { unpublishStatsCommand };

function unpublishStatsCommand(): void {
	void (async () => {
		try {
			profileAggregate.replace(await profileService.unpublish());
		} catch (error) {
			toast.error(
				`Could not stop publishing your stats · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
