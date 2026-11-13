import { heardAboutSetting, type HeardAbout } from '$lib/app/domain/heard-about';
import { onboardingService } from '$lib/app/infrastructure/services/onboarding.service';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function answerHeardAboutCommand(answer: HeardAbout | null): void {
	onboardingStore.heardAbout = answer;
	onboardingStore.heardAboutSetting = heardAboutSetting(answer);
	onboardingStore.heardAboutSent = answer !== null;
	void (async () => {
		try {
			await onboardingService.answerHeardAbout(answer);
		} catch (error) {
			console.error('[malini app] could not remember where you heard about Malini', error);
		}
	})();
}
