import {
	provisioningWorkstreamRow,
	type WorkstreamProvisioningPlan,
} from '$shared/repositories/domain/provisioning';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';
import { provisionWorkstreamCommand } from './provision-workstream.command';

export { startPlannedWorkstreamCommand };

function startPlannedWorkstreamCommand(
	plan: WorkstreamProvisioningPlan,
	inBackground = false,
): void {
	if (workstreamProvisioning.hasUnstartedAttemptForProject(plan.projectId)) return;
	workstreamsAggregate.stagePendingWorkstream(provisioningWorkstreamRow(plan));
	workstreamProvisioning.begin(plan);
	if (inBackground) {
		provisionWorkstreamCommand(plan);
		return;
	}
	void (async () => {
		await goto(workstreamHref(plan.workstreamId));
		provisionWorkstreamCommand(plan);
	})();
}
