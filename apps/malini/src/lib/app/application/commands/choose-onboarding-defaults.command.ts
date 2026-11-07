import type { AutomationDefaults, DefaultsChoice } from '$lib/app/domain/automation-defaults';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function chooseOnboardingDefaultsCommand(choice: DefaultsChoice): void {
	onboardingStore.defaultsChoice = choice;
}

export function customizeOnboardingDefaultsCommand(change: Partial<AutomationDefaults>): void {
	onboardingStore.customDefaults = { ...onboardingStore.customDefaults, ...change };
}
