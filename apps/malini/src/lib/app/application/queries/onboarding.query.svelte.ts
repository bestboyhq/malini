import { archivedWorkstreamsQuery } from '$shared/repositories/repositories.api';
import type { HeardAbout } from '$lib/app/domain/heard-about';
import { onboardingStore } from '$lib/app/infrastructure/stores/onboarding.store.svelte';

type Onboarding = Readonly<{
	picking: boolean;
	heardAboutUnanswered: boolean;
	firstMerge: boolean;
	heardAbout: HeardAbout | null;
	heardAboutSent: boolean;
}>;

class OnboardingQuery {
	public readonly data: Onboarding = $derived({
		picking: onboardingStore.picking,
		heardAboutUnanswered: onboardingStore.heardAboutAsked === false,
		firstMerge: archivedWorkstreamsQuery.data.some(
			(workstream) => workstream.mergedPullRequest !== null,
		),
		heardAbout: onboardingStore.heardAbout,
		heardAboutSent: onboardingStore.heardAboutSent,
	});
}

export const onboardingQuery = new OnboardingQuery();
