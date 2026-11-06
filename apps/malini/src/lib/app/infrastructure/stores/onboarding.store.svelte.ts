import type { HeardAbout } from '$lib/app/domain/heard-about';
import type { OnboardingScreen } from '$lib/app/domain/onboarding';

class OnboardingStore {
	finished = $state<boolean | null>(null);
	step = $state(0);
	direction = $state<1 | -1>(1);
	shown = $state<OnboardingScreen | null>(null);
	heardAbout = $state<HeardAbout | null>(null);
	finishing = false;
}

export const onboardingStore = new OnboardingStore();
