import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

export function leaveFirstChatCommand(): void {
	onboardingStore.waitInFirstChat(null);
}
