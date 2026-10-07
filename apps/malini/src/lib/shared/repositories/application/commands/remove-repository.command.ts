import { toast } from '$hyper-ui/components/toast';
import {
	workstreamNativeExistence,
	type WorkstreamNativeExistence,
} from '$shared/repositories/domain/provisioning';
import type { Repository } from '$shared/repositories/domain/repository';
import type { Workstream } from '$shared/repositories/domain/workstream';
import {
	retirementFailureMessage,
	retirementFailureToast,
} from '$shared/repositories/domain/workstream-retirement';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';
import { repositoryRemovalStore } from '$shared/repositories/infrastructure/stores/repository-removal.store.svelte';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';
import { abandonWorkstreamProvisioningCommand } from './abandon-workstream-provisioning.command';

export { removeRepositoryCommand };

function removeRepositoryCommand(repository: Repository, workstreams: readonly Workstream[]): void {
	const existence = (workstream: Workstream): WorkstreamNativeExistence =>
		workstreamNativeExistence(workstreamProvisioning.get(workstream.id));
	if (workstreams.some((workstream) => existence(workstream) === 'in-flight')) return;
	if (!repositoryRemovalStore.start(repository.id)) return;
	const failedSetups = workstreams.filter((workstream) => existence(workstream) === 'absent');
	for (const workstream of workstreams) {
		workstreamsAggregate.retireWorkstreamOptimistically(workstream.id);
	}

	void (async () => {
		if (workstreams.some((workstream) => workstream.id === page.params.workstreamId)) {
			await goto(REPOSITORIES_HREF);
		}
		const failure = await removalFailure(repository);
		for (const workstream of workstreams)
			workstreamsAggregate.forgetRetiredWorkstream(workstream.id);
		if (failure === null) {
			for (const workstream of failedSetups) abandonWorkstreamProvisioningCommand(workstream.id);
			repositoriesAggregate.forget(repository.id);
		}
		await workstreamsAggregate.refresh();
		repositoryRemovalStore.finish(repository.id);
		if (failure !== null) {
			toast.error(retirementFailureToast('remove', repository.fullName, failure));
		}
	})();
}

async function removalFailure(repository: Repository): Promise<string | null> {
	try {
		await githubService.removeRepository(repository.id);
		return null;
	} catch (error) {
		return retirementFailureMessage(error);
	}
}
