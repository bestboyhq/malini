import { trimmedOutputAggregate } from '$lib/stats/infrastructure/aggregates/trimmed-output.aggregate.svelte';

export { loadTrimmedOutputCommand };

function loadTrimmedOutputCommand(): void {
	void (async () => {
		try {
			await trimmedOutputAggregate.load();
		} catch (error) {
			console.error('[malini stats] could not load trimmed output', error);
		}
	})();
}
