import { githubAuthQuery, loadGithubAuthCommand } from '$shared/repositories/repositories.api';
import { activityAggregate } from '$lib/stats/infrastructure/aggregates/activity.aggregate.svelte';
import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';

export { loadProfileBadgeCommand };

function loadProfileBadgeCommand(): void {
	if (!githubAuthQuery.data) loadGithubAuthCommand();
	void (async () => {
		try {
			await profileAggregate.load();
			if (profileAggregate.state?.account) await activityAggregate.load();
		} catch (error) {
			console.error('[malini stats] could not load your profile badge', error);
		}
	})();
}
