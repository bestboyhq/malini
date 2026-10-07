import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamActionFailureMessage } from '$shared/repositories/domain/workstream-action';
import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
import {
	retirementFailureToast,
	savedWorkNote,
	type WorkstreamRetirementOutcome,
} from '$shared/repositories/domain/workstream-retirement';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { workstreamActionsStore } from '$shared/repositories/infrastructure/stores/workstream-actions.store.svelte';
import { workstreamRetirementStore } from '$shared/repositories/infrastructure/stores/workstream-retirement.store.svelte';
import { clipboardService } from '$shared/system/clipboard.service';

export { deleteWorkstreamCommand };

function deleteWorkstreamCommand(workstreamId: string, onDeleted?: () => void): void {
	if (workstreamActionsStore.busyFor(workstreamId)) return;
	workstreamActionsStore.begin(workstreamId, 'delete');
	workstreamRetirementStore.track(workstreamId, deleteWorkstream(workstreamId, onDeleted));
}

async function deleteWorkstream(
	workstreamId: string,
	onDeleted?: () => void,
): Promise<WorkstreamRetirementOutcome> {
	const name = workstreamName(workstreamId);
	try {
		const savedWork = await workstreamsService.delete(workstreamId);
		workstreamsAggregate.remove(workstreamId);
		if (savedWork) {
			const { ref } = savedWork;
			toast.info(`Deleted ${name} · ${savedWorkNote(savedWork)}`, {
				...aboutWorkstream(workstreamId),
				action: {
					label: 'Copy ref',
					onclick: () => void clipboardService.write(ref),
				},
			});
		}
		workstreamActionsStore.finish(workstreamId);
		onDeleted?.();
		return { status: 'retired' };
	} catch (cause) {
		const message = workstreamActionFailureMessage(
			cause,
			'Removing it failed, so nothing was removed',
		);
		toast.error(retirementFailureToast('delete', name, message), aboutWorkstream(workstreamId));
		workstreamActionsStore.finish(workstreamId);
		return { status: 'failed', message };
	}
}

function workstreamName(workstreamId: string): string {
	const workstream = workstreamsAggregate.workstreams.find((entry) => entry.id === workstreamId);
	return workstream ? displayWorkstreamName(workstream) : 'this workstream';
}
