import type { PlanSyncedEvent } from '$contract/initiatives';
import { toast } from '$hyper-ui/components/toast';
import { loadInitiativesCommand } from '$lib/initiatives/application/commands/load-initiatives.command';
import { remoteChangeLine } from '$lib/initiatives/domain/plan';
import { planSyncAggregate } from '$lib/initiatives/infrastructure/aggregates/plan-sync.aggregate.svelte';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';

export { acceptPlanSyncedCommand };

function acceptPlanSyncedCommand(event: PlanSyncedEvent): void {
	for (const change of event.changes) toast.info(remoteChangeLine(change));
	loadInitiativesCommand();
	void (async () => {
		try {
			planSyncAggregate.set(await initiativesService.syncState(event.repositoryFullName));
		} catch {
			return;
		}
	})();
}
