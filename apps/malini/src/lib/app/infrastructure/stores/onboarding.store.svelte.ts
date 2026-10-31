import type { HeardAbout } from '$lib/app/domain/heard-about';

class OnboardingStore {
	finished = $state<boolean | null>(null);
	step = $state(0);
	direction = $state<1 | -1>(1);
	shown = $state(false);
	heardAbout = $state<HeardAbout | null>(null);
}

export const onboardingStore = new OnboardingStore();
