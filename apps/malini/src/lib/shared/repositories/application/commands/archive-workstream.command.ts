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
	retirementFailureToast,
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
import { abandonWorkstreamProvisioningCommand } from './abandon-workstream-provisioning.command';

export { archiveWorkstreamCommand };

function archiveWorkstreamCommand(
	workstream: Workstream,
	announceLifecycle: WorkstreamLifecycleAnnouncer,
): void {
	if (workstreamRetirementStore.isRetiring(workstream.id)) return;
	const existence = workstreamNativeExistence(workstreamProvisioning.get(workstream.id));
	if (existence === 'in-flight') return;
	const destination = destinationAfter(workstream.id);
	if (existence === 'absent') {
		abandonWorkstreamProvisioningCommand(workstream.id);
		void leaveIfActive(workstream.id, destination);
		return;
	}

	const settled = workstreamRetirementStore.retire({
		workstreamId: workstream.id,
		commit: async () => {
			await workstreamsService.archive(workstream.id);
			announceLifecycle('archived', workstream.id);
		},
	});
	if (!settled) return;

	void (async () => {
		await leaveIfActive(workstream.id, destination);
		const outcome = await settled;
		if (outcome.status !== 'failed') return;
		toast.error(
			retirementFailureToast('archive', displayWorkstreamName(workstream), outcome.message),
			aboutWorkstream(workstream.id),
		);
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
