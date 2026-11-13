import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function showOnboardingHook(): () => void {
	onboardingStore.picking = true;
	return () => {
		onboardingStore.picking = false;
	};
}
