import { onboardingService } from '$lib/app/infrastructure/services/onboarding.service';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function loadOnboardingCommand(): void {
	void (async () => {
		try {
			onboardingStore.heardAboutSetting = await onboardingService.heardAboutSetting();
		} catch (error) {
			console.error('[malini app] could not read where you heard about Malini', error);
		}
	})();
}
