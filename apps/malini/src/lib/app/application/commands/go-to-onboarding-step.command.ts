import { clampOnboardingStep } from '$lib/app/domain/onboarding';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function goToOnboardingStepCommand(step: number): void {
	const next = clampOnboardingStep(step);
	if (next === onboardingStore.step) return;
	onboardingStore.direction = next > onboardingStore.step ? 1 : -1;
	onboardingStore.step = next;
}
