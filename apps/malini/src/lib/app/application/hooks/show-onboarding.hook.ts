import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function showOnboardingHook(): () => void {
	onboardingStore.shown = true;
	return () => {
		onboardingStore.shown = false;
	};
}
