import type { HeardAbout } from '$lib/app/domain/heard-about';
import { ONBOARDING_STEPS, type OnboardingStep } from '$lib/app/domain/onboarding';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

type Onboarding = Readonly<{
	finished: boolean | null;
	step: OnboardingStep;
	index: number;
	direction: 1 | -1;
	shown: boolean;
	heardAbout: HeardAbout | null;
}>;

class OnboardingQuery {
	public readonly data: Onboarding = $derived({
		finished: onboardingStore.finished,
		step: ONBOARDING_STEPS[onboardingStore.step] ?? 'accounts',
		index: onboardingStore.step,
		direction: onboardingStore.direction,
		shown: onboardingStore.shown,
		heardAbout: onboardingStore.heardAbout,
	});
}

export const onboardingQuery = new OnboardingQuery();
