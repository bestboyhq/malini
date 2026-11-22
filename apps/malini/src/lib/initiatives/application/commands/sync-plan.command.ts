import { initiativesAggregate } from '$lib/initiatives/infrastructure/aggregates/initiatives.aggregate.svelte';
import { planSyncAggregate } from '$lib/initiatives/infrastructure/aggregates/plan-sync.aggregate.svelte';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { syncPlanCommand };

function syncPlanCommand(repositoryFullName: string): void {
	if (!planSyncAggregate.begin(repositoryFullName)) return;
	void (async () => {
		try {
			const state = await initiativesService.syncState(repositoryFullName);
			planSyncAggregate.set(state);
			if (!state.enabled) return;
			const list = await initiativesService.sync(repositoryFullName);
			initiativesAggregate.setRepository(repositoryFullName, list);
			planSyncAggregate.set(await initiativesService.syncState(repositoryFullName));
		} catch (error) {
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			planSyncAggregate.fail(repositoryFullName, detail || 'GitHub did not answer');
		} finally {
			planSyncAggregate.end(repositoryFullName);
		}
	})();
}
