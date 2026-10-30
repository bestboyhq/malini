import { toast } from '$hyper-ui/components/toast';
import type { StatsPart } from '$contract/stats';
import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

export { sharePartCommand };

function sharePartCommand(part: StatsPart, on: boolean): void {
	void (async () => {
		try {
			profileAggregate.replace(await profileService.sharePart(part, on));
		} catch (error) {
			toast.error(
				`Could not change what your profile shows · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
