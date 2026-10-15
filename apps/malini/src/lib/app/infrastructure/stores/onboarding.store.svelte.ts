class OnboardingStore {
	finished = $state<boolean | null>(null);
	step = $state(0);
	direction = $state<1 | -1>(1);
}

export const onboardingStore = new OnboardingStore();
