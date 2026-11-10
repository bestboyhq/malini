import type { AutomationDefaults, DefaultsChoice } from '$lib/app/domain/automation-defaults';
import type { HeardAbout } from '$lib/app/domain/heard-about';
import {
	ONBOARDING_STEPS,
	type OnboardingScreen,
	type OnboardingSidebar,
	type OnboardingStep,
} from '$lib/app/domain/onboarding';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

type Onboarding = Readonly<{
	finished: boolean | null;
	step: OnboardingStep;
	index: number;
	direction: 1 | -1;
	shown: OnboardingScreen | null;
	heardAbout: HeardAbout | null;
	sidebar: OnboardingSidebar;
	defaultsChoice: DefaultsChoice;
	customDefaults: AutomationDefaults;
}>;

class OnboardingQuery {
	public readonly data: Onboarding = $derived({
		finished: onboardingStore.finished,
		step: ONBOARDING_STEPS[onboardingStore.step] ?? 'tools',
		index: onboardingStore.step,
		direction: onboardingStore.direction,
		shown: onboardingStore.shown,
		heardAbout: onboardingStore.heardAbout,
		sidebar: onboardingStore.sidebar,
		defaultsChoice: onboardingStore.defaultsChoice,
		customDefaults: onboardingStore.customDefaults,
	});
}

export const onboardingQuery = new OnboardingQuery();
