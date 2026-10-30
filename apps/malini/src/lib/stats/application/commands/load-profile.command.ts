import { profileAggregate } from '$lib/stats/infrastructure/aggregates/profile.aggregate.svelte';

export { loadProfileCommand };

function loadProfileCommand(): void {
	void (async () => {
		try {
			await profileAggregate.load();
		} catch (error) {
			console.error('[malini stats] could not load your Bestboy profile', error);
		}
	})();
}
