import { resourcesAggregate } from '$lib/stats/infrastructure/aggregates/resources.aggregate.svelte';

export { loadResourcesCommand };

function loadResourcesCommand(): void {
	void (async () => {
		try {
			await resourcesAggregate.load();
		} catch (error) {
			console.error('[malini stats] could not load resource usage', error);
		}
	})();
}
