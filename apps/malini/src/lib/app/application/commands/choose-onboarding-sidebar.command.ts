import type { OnboardingSidebar } from '$lib/app/domain/onboarding';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function chooseOnboardingSidebarCommand(change: Partial<OnboardingSidebar>): void {
	onboardingStore.sidebar = { ...onboardingStore.sidebar, ...change };
}
