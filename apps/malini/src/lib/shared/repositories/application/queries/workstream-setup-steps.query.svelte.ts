import { unusableCheckoutIssue } from '$shared/repositories/domain/workstream';
import {
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
	public readonly data: (workstreamId: string) => readonly WorkstreamSetupStep[] = $derived(
		(workstreamId: string) => {
			const workstream = workstreamsAggregate.workstreams.find(({ id }) => id === workstreamId);
			if (!workstream) return [];
			return workstreamSetupSteps({
				workstreamId,
				branch: workstream.branch,
				provisioning: workstreamProvisioning.get(workstreamId),
				install: workstreamDependencyInstall.get(workstreamId),
				checkout: checkoutHealthAggregate.healthOf(workstreamId),
				checkoutIssue: unusableCheckoutIssue(workstream),
			});
		},
	);
}

const workstreamSetupStepsQuery = new WorkstreamSetupStepsQuery();
