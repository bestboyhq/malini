import {
	workstreamSetupSteps,
	type WorkstreamSetupStep,
} from '$shared/repositories/domain/workstream-setup-steps';
import {
	workstreamDependencyInstall,
	workstreamProvisioning,
} from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamHeadQuery } from '$shared/repositories/application/queries/workstream-head.query.svelte';

export { workstreamSetupStepsQuery };

class WorkstreamSetupStepsQuery {
	public readonly data: (workstreamId: string) => readonly WorkstreamSetupStep[] = $derived(
		(workstreamId: string) => {
			const workstream = workstreamsAggregate.workstreams.find(({ id }) => id === workstreamId);
			if (!workstream) return [];
			return workstreamSetupSteps({
				workstreamId,
				branch: workstream.branch,
				baseBranch: workstream.baseBranch,
				provisioning: workstreamProvisioning.get(workstreamId),
				head: workstreamHeadQuery.data(workstreamId),
				install: workstreamDependencyInstall.get(workstreamId),
			});
		},
	);
}

const workstreamSetupStepsQuery = new WorkstreamSetupStepsQuery();
