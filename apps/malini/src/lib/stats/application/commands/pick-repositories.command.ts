import { toast } from '$hyper-ui/components/toast';
import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

export { pickRepositoriesCommand };

function pickRepositoriesCommand(repositories: readonly string[]): void {
	void (async () => {
		try {
			profileAggregate.replace(await profileService.pickRepositories(repositories));
		} catch (error) {
			toast.error(
				`Could not save your public repositories · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
