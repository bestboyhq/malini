import {
	planWorkstreamProvisioning,
	provisioningWorkstreamRow,
} from '$shared/repositories/domain/provisioning';
import type { Repository } from '$shared/repositories/domain/repository';
import { takenWorkstreamNames } from '$shared/repositories/domain/workstream-names';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';
import { provisionWorkstreamCommand } from './provision-workstream.command';

export { createWorkstreamForRepositoryCommand };

function createWorkstreamForRepositoryCommand(repo: Repository): void {
	const plan = planWorkstreamProvisioning({
		repo,
		projects: workstreamsAggregate.projects,
		takenNames: takenWorkstreamNames(workstreamsAggregate.workstreams),
	});
	if (workstreamProvisioning.hasUnstartedAttemptForProject(plan.projectId)) return;
	workstreamsAggregate.stagePendingWorkstream(provisioningWorkstreamRow(plan));
	workstreamProvisioning.begin(plan);
	void (async () => {
		await goto(workstreamHref(plan.workstreamId));
		provisionWorkstreamCommand(plan);
	})();
}
