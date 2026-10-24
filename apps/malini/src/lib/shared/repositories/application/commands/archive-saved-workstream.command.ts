import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamActionFailureMessage } from '$shared/repositories/domain/workstream-action';
import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
import { retirementFailureToast } from '$shared/repositories/domain/workstream-retirement';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { workstreamActionsStore } from '$shared/repositories/infrastructure/stores/workstream-actions.store.svelte';

export { archiveSavedWorkstreamCommand };

function archiveSavedWorkstreamCommand(workstreamId: string): void {
	const saved = workstreamsAggregate.archived.find(
		(entry) => entry.id === workstreamId && entry.savedForLater,
	);
	if (!saved || workstreamActionsStore.busyFor(workstreamId)) return;
	workstreamActionsStore.begin(workstreamId, 'archive');
	void (async () => {
		try {
			await workstreamsService.archive(workstreamId);
			await workstreamsAggregate.refresh();
		} catch (cause) {
			toast.error(
				retirementFailureToast(
					'archive',
					displayWorkstreamName(saved),
					workstreamActionFailureMessage(cause, 'It stays saved for later'),
				),
				aboutWorkstream(workstreamId),
			);
		} finally {
			workstreamActionsStore.finish(workstreamId);
		}
	})();
}
