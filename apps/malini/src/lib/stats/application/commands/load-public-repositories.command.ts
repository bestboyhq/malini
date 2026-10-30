import { publicRepositoriesAggregate } from '$lib/stats/infrastructure/aggregates/public-repositories.aggregate.svelte';

export { loadPublicRepositoriesCommand };

function loadPublicRepositoriesCommand(): void {
	void (async () => {
		try {
			await publicRepositoriesAggregate.load();
		} catch (error) {
			console.error('[malini stats] could not list your public repositories', error);
		}
	})();
}
