import {
	setupRepositoryName,
	workstreamSetupSteps,
	type WorkstreamSetupStep,
} from '$shared/repositories/domain/workstream-setup-steps';
import { checkoutHealthAggregate } from '$shared/repositories/infrastructure/aggregates/checkout-health.aggregate.svelte';
import {
	workstreamDependencyInstall,
	workstreamProvisioning,
} from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { workstreamSetupStepsQuery };

class WorkstreamSetupStepsQuery {
	public readonly data: (
		workstreamId: string,
		agentFixing: boolean,
	) => readonly WorkstreamSetupStep[] = $derived((workstreamId: string, agentFixing: boolean) => {
		const workstream = workstreamsAggregate.workstreams.find(({ id }) => id === workstreamId);
		if (!workstream) return [];
		return workstreamSetupSteps({
			workstreamId,
			branch: workstream.branch,
			repository: setupRepositoryName(workstream.projectId, workstreamsAggregate.projects),
			provisioning: workstreamProvisioning.get(workstreamId),
			install: workstreamDependencyInstall.get(workstreamId),
			checkout: checkoutHealthAggregate.healthOf(workstreamId),
			clonePercent: checkoutHealthAggregate.clonePercentOf(workstreamId),
			agentFixing,
		});
	});
}

const workstreamSetupStepsQuery = new WorkstreamSetupStepsQuery();
