import type { HeardAbout } from '$lib/app/domain/heard-about';

class OnboardingStore {
	picking = $state(false);
	heardAboutAsked = $state<boolean | undefined>(undefined);
	heardAbout = $state<HeardAbout | null>(null);
	heardAboutSent = $state(false);
}

export const onboardingStore = new OnboardingStore();
