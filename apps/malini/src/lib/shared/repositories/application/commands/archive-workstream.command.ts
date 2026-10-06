import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamNativeExistence } from '$shared/repositories/domain/provisioning';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
import {
	WORKSTREAM_UNDO_WINDOW_MS,
	retirementFailureToast,
	savedWorkNote,
	type SavedWorkstreamWork,
	type WorkstreamLifecycleAnnouncer,
} from '$shared/repositories/domain/workstream-retirement';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { workstreamRetirementStore } from '$shared/repositories/infrastructure/stores/workstream-retirement.store.svelte';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';
import { clipboardService } from '$shared/system/clipboard.service';
import { abandonWorkstreamProvisioningCommand } from './abandon-workstream-provisioning.command';
import { undoWorkstreamRetirementCommand } from './undo-workstream-retirement.command';

export { archiveWorkstreamCommand };

function archiveWorkstreamCommand(
	workstream: Workstream,
	announceLifecycle: WorkstreamLifecycleAnnouncer,
): void {
	if (workstreamRetirementStore.isPending(workstream.id)) return;
	const existence = workstreamNativeExistence(workstreamProvisioning.get(workstream.id));
	if (existence === 'in-flight') return;
	if (existence === 'absent') {
		abandonWorkstreamProvisioningCommand(workstream.id);
		void leaveIfActive(workstream.id);
		return;
	}

	let savedWork: SavedWorkstreamWork | null = null;
	const settled = workstreamRetirementStore.retire({
		workstreamId: workstream.id,
		commit: async () => {
			savedWork = await workstreamsService.archive(workstream.id);
			announceLifecycle('archived', workstream.id);
		},
	});
	if (!settled) return;

	void (async () => {
		await leaveIfActive(workstream.id);
		const name = displayWorkstreamName(workstream);
		const toastId = toast.info(
			`Archived ${name}`,
			aboutWorkstream(workstream.id, {
				ttlMs: WORKSTREAM_UNDO_WINDOW_MS,
				action: {
					label: 'Undo',
					onclick: () => undoWorkstreamRetirementCommand(workstream.id),
				},
			}),
		);
		const outcome = await settled;
		toast.dismiss(toastId);
		if (outcome.status === 'failed') {
			toast.error(
				retirementFailureToast('archive', name, outcome.message),
				aboutWorkstream(workstream.id),
			);
			return;
		}
		if (outcome.status === 'retired' && savedWork) {
			const { ref } = savedWork;
			toast.info(`Archived ${name} · ${savedWorkNote(savedWork)}`, {
				...aboutWorkstream(workstream.id),
				action: {
					label: 'Copy ref',
					onclick: () => void clipboardService.write(ref),
				},
			});
		}
	})();
}

async function leaveIfActive(workstreamId: string): Promise<void> {
	if (page.params.workstreamId !== workstreamId) return;
	await goto(REPOSITORIES_HREF);
}
