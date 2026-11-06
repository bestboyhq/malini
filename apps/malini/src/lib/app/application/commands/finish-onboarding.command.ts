import { onboardingService } from '$lib/app/infrastructure/services/onboarding.service';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function finishOnboardingCommand(): void {
	if (onboardingStore.finishing) return;
	onboardingStore.finishing = true;
	onboardingStore.finished = true;
	void (async () => {
		try {
			await onboardingService.finish();
		} catch (error) {
			console.error('[malini app] could not remember that setup is finished', error);
		}
	})();
}
