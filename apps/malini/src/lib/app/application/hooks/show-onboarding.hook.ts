import type { OnboardingScreen } from '$lib/app/domain/onboarding';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function showOnboardingHook(screen: OnboardingScreen): () => void {
	onboardingStore.shown = screen;
	return () => {
		onboardingStore.shown = null;
	};
}
