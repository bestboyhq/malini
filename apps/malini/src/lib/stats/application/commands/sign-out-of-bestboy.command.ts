import { toast } from '$hyper-ui/components/toast';
import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';

export { signOutOfBestboyCommand };

function signOutOfBestboyCommand(): void {
	void (async () => {
		try {
			profileAggregate.replace(await profileService.signOut());
		} catch (error) {
			toast.error(
				`Could not sign out of Bestboy · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
