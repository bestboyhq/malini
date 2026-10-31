import type { HeardAbout } from '$lib/app/domain/heard-about';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function chooseHeardAboutCommand(answer: HeardAbout): void {
	onboardingStore.heardAbout = answer;
}
