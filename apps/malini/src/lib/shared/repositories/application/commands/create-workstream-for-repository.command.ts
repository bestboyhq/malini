import {
	planWorkstreamProvisioning,
	provisioningWorkstreamRow,
} from '$shared/repositories/domain/provisioning';
import type { Repository } from '$shared/repositories/domain/repository';
import type { WorkstreamId } from '$shared/repositories/domain/workstream';
import { takenWorkstreamNames } from '$shared/repositories/domain/workstream-names';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';
import { provisionWorkstreamCommand } from './provision-workstream.command';

export { createWorkstreamForRepositoryCommand };

type WorkstreamCreation = Readonly<{ workstreamId?: WorkstreamId; inBackground?: boolean }>;

function createWorkstreamForRepositoryCommand(
	repo: Repository,
	creation: WorkstreamCreation = {},
): void {
	const plan = planWorkstreamProvisioning({
		repo,
		projects: workstreamsAggregate.projects,
		takenNames: takenWorkstreamNames(workstreamsAggregate.workstreams),
		...(creation.workstreamId ? { workstreamId: creation.workstreamId } : {}),
	});
	if (workstreamProvisioning.hasUnstartedAttemptForProject(plan.projectId)) return;
	workstreamsAggregate.stagePendingWorkstream(provisioningWorkstreamRow(plan));
	workstreamProvisioning.begin(plan);
	if (!creation.inBackground) {
		void (async () => {
			await goto(workstreamHref(plan.workstreamId));
			provisionWorkstreamCommand(plan);
		})();
		return;
	}
	provisionWorkstreamCommand(plan);
}
