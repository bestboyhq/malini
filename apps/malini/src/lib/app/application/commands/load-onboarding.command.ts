import { onboardingService } from '$lib/app/infrastructure/services/onboarding.service';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function loadOnboardingCommand(): void {
	void (async () => {
		try {
			onboardingStore.finished = await onboardingService.finished();
		} catch (error) {
			onboardingStore.finished = false;
			console.error('[malini app] could not read whether setup is finished', error);
		}
	})();
}
