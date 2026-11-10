import {
	RECOMMENDED,
	type AutomationDefaults,
	type DefaultsChoice,
} from '$lib/app/domain/automation-defaults';
import type { HeardAbout } from '$lib/app/domain/heard-about';
import {
	DEFAULT_ONBOARDING_SIDEBAR,
	type OnboardingScreen,
	type OnboardingSidebar,
} from '$lib/app/domain/onboarding';

class OnboardingStore {
	finished = $state<boolean | null>(null);
	step = $state(0);
	direction = $state<1 | -1>(1);
	shown = $state<OnboardingScreen | null>(null);
	heardAbout = $state<HeardAbout | null>(null);
	sidebar = $state<OnboardingSidebar>(DEFAULT_ONBOARDING_SIDEBAR);
	defaultsChoice = $state<DefaultsChoice>('recommended');
	customDefaults = $state<AutomationDefaults>(RECOMMENDED);
	finishing = false;
}

export const onboardingStore = new OnboardingStore();
