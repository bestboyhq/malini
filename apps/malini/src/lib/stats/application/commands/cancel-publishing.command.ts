import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';
import { profileService } from '$lib/stats/infrastructure/services/profile.service';
import { publishFlowStore } from '$lib/stats/infrastructure/stores/publish-flow.store.svelte';

export { cancelPublishingCommand };

function cancelPublishingCommand(): void {
	publishFlowStore.finish();
	if (!profileAggregate.state?.signingIn) return;
	void (async () => {
		try {
			profileAggregate.replace(await profileService.cancelSignIn());
		} catch (error) {
			console.error('[malini stats] could not cancel the Bestboy sign-in', error);
		}
	})();
}
