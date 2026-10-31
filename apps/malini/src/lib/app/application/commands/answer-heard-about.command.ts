import type { HeardAbout } from '$lib/app/domain/heard-about';
import { onboardingService } from '$lib/app/infrastructure/services/onboarding.service';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function answerHeardAboutCommand(answer: HeardAbout | null): void {
	onboardingStore.heardAbout = answer;
	void (async () => {
		try {
			await onboardingService.answerHeardAbout(answer);
		} catch (error) {
			console.error('[malini app] could not remember where you heard about Malini', error);
		}
	})();
}
