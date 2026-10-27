import { shareCardAggregate } from '$lib/stats/infrastructure/aggregates/share-card.aggregate.svelte';

export { loadShareCardCommand };

function loadShareCardCommand(): void {
	void (async () => {
		try {
			await shareCardAggregate.load();
		} catch (error) {
			console.error('[malini stats] could not read the share card', error);
		}
	})();
}
