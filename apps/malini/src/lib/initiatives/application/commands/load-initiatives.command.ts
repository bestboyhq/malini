import { initiativesAggregate } from '$lib/initiatives/infrastructure/aggregates/initiatives.aggregate.svelte';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';

export { loadInitiativesCommand };

function loadInitiativesCommand(): void {
	initiativesAggregate.clearError();
	void (async () => {
		try {
			initiativesAggregate.set(await initiativesService.list());
		} catch (error) {
			initiativesAggregate.fail(error instanceof Error ? error.message : String(error));
		}
	})();
}
