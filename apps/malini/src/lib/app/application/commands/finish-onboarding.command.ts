import { onboardingService } from '$lib/app/infrastructure/services/onboarding.service';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';
import {
	HOME_SCOPE,
	nextWorkstreamId,
	startLeadChatCommand,
} from '$shared/repositories/repositories.api';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';

export function finishOnboardingCommand(): void {
	if (onboardingStore.finishing) return;
	onboardingStore.finishing = true;
	const firstChatId = nextWorkstreamId();
	onboardingStore.waitInFirstChat(firstChatId);
	startLeadChatCommand(HOME_SCOPE, { workstreamId: firstChatId, inBackground: true });
	void (async () => {
		try {
			await goto(workstreamHref(firstChatId));
		} finally {
			onboardingStore.finished = true;
		}
		try {
			await onboardingService.finish();
		} catch (error) {
			console.error('[malini app] could not remember that setup is finished', error);
		}
	})();
}
