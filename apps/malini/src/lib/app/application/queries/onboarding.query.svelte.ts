import { ONBOARDING_STEPS, type OnboardingStep } from '$lib/app/domain/onboarding';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

type Onboarding = Readonly<{
	finished: boolean | null;
	step: OnboardingStep;
	index: number;
	direction: 1 | -1;
}>;

class OnboardingQuery {
	public readonly data: Onboarding = $derived({
		finished: onboardingStore.finished,
		step: ONBOARDING_STEPS[onboardingStore.step] ?? 'claude-code',
		index: onboardingStore.step,
		direction: onboardingStore.direction,
	});
}

export const onboardingQuery = new OnboardingQuery();
