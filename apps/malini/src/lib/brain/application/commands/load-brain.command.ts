import { brainAggregate } from '$lib/brain/infrastructure/aggregates/brain.aggregate.svelte';

export { loadBrainCommand };

function loadBrainCommand(): void {
	void (async () => {
		try {
			await brainAggregate.refresh();
		} catch (error) {
			console.error('[malini brain] could not load the brain', error);
		}
	})();
}
