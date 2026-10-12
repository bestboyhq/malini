import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamActionFailureMessage } from '$shared/repositories/domain/workstream-action';
import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
import { retirementFailureToast } from '$shared/repositories/domain/workstream-retirement';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { workstreamActionsStore } from '$shared/repositories/infrastructure/stores/workstream-actions.store.svelte';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';
import { seedWorkstreamDependenciesCommand } from './seed-workstream-dependencies.command';

export { restoreWorkstreamCommand };

function restoreWorkstreamCommand(workstreamId: string, onRestored?: () => void): void {
	const archived = workstreamsAggregate.archived.find((entry) => entry.id === workstreamId);
	if (!archived || workstreamActionsStore.busyFor(workstreamId)) return;
	workstreamActionsStore.begin(workstreamId, 'restore');
	void (async () => {
		try {
			await workstreamsService.restore(workstreamId);
			await workstreamsAggregate.refresh();
			onRestored?.();
			await goto(workstreamHref(workstreamId));
			seedWorkstreamDependenciesCommand(workstreamId);
		} catch (cause) {
			toast.error(
				retirementFailureToast(
					'restore',
					displayWorkstreamName(archived),
					workstreamActionFailureMessage(cause, 'Its checkout could not be recreated'),
				),
				aboutWorkstream(workstreamId),
			);
		} finally {
			workstreamActionsStore.finish(workstreamId);
		}
	})();
}
