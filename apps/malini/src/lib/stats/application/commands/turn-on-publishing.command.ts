import { toast } from '$hyper-ui/components/toast';
import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';
import { publishFlowStore } from '$lib/stats/infrastructure/stores/publish-flow.store.svelte';

export { turnOnPublishingCommand };

function turnOnPublishingCommand(): void {
	publishFlowStore.start();
	if (profileAggregate.state?.account) return;
	void (async () => {
		try {
			profileAggregate.replace(await profileService.signIn());
		} catch (error) {
			publishFlowStore.finish();
			toast.error(`Could not sign in to Bestboy · ${errorText(error)}`);
		}
	})();
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
