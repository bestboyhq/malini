import { toast } from '$hyper-ui/components/toast';
import { syncPlanCommand } from '$lib/initiatives/application/commands/sync-plan.command';
import { planSyncAggregate } from '$lib/initiatives/infrastructure/aggregates/plan-sync.aggregate.svelte';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { setPlanSyncCommand };

function setPlanSyncCommand(repositoryFullName: string, enabled: boolean): void {
	const before = planSyncAggregate.states[repositoryFullName];
	if (before) planSyncAggregate.set({ ...before, enabled, error: null });
	void (async () => {
		try {
			planSyncAggregate.set(await initiativesService.setSync({ repositoryFullName, enabled }));
			if (enabled) syncPlanCommand(repositoryFullName);
		} catch (error) {
			if (before) planSyncAggregate.set(before);
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			toast.error(
				`Sync with GitHub not turned ${enabled ? 'on' : 'off'}${detail ? ` · ${detail}` : ''}.`,
			);
		}
	})();
}
