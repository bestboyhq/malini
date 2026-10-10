import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamNativeExistence } from '$shared/repositories/domain/provisioning';
import {
	localRepositoriesFromProjects,
	mergeRepositories,
	nextListedWorkstream,
} from '$shared/repositories/domain/repository-context';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
import {
	WORKSTREAM_UNDO_WINDOW_MS,
	retirementFailureToast,
	savedWorkNote,
	type SavedWorkstreamWork,
	type WorkstreamLifecycleAnnouncer,
} from '$shared/repositories/domain/workstream-retirement';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { repositoryRemovalStore } from '$shared/repositories/infrastructure/stores/repository-removal.store.svelte';
import { workstreamRetirementStore } from '$shared/repositories/infrastructure/stores/workstream-retirement.store.svelte';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF, workstreamHref } from '$shared/router/routes-hrefs';
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
	const destination = destinationAfter(workstream.id);
	if (existence === 'absent') {
		abandonWorkstreamProvisioningCommand(workstream.id);
		void leaveIfActive(workstream.id, destination);
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
		await leaveIfActive(workstream.id, destination);
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

function destinationAfter(workstreamId: string): string {
	const next = nextListedWorkstream({
		repositories: mergeRepositories(
			repositoriesAggregate.items,
			localRepositoriesFromProjects(workstreamsAggregate.projects),
		).filter((repository) => !repositoryRemovalStore.removing.has(repository.id)),
		workstreams: workstreamsAggregate.workstreams.filter(
			(candidate) => candidate.status !== 'archived',
		),
		workstreamId,
	});
	return next ? workstreamHref(next.id) : REPOSITORIES_HREF;
}

async function leaveIfActive(workstreamId: string, destination: string): Promise<void> {
	if (page.params.workstreamId !== workstreamId) return;
	await goto(destination);
}
