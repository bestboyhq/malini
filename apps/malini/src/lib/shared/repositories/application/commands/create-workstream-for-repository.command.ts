import { planWorkstreamProvisioning } from '$shared/repositories/domain/provisioning';
import type { Repository } from '$shared/repositories/domain/repository';
import type { WorkstreamId } from '$shared/repositories/domain/workstream';
import { takenWorkstreamNames } from '$shared/repositories/domain/workstream-names';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { startPlannedWorkstreamCommand } from './start-planned-workstream.command';

export { createWorkstreamForRepositoryCommand };

type WorkstreamCreation = Readonly<{ workstreamId?: WorkstreamId; inBackground?: boolean }>;

function createWorkstreamForRepositoryCommand(
	repo: Repository,
	creation: WorkstreamCreation = {},
): void {
	startPlannedWorkstreamCommand(
		planWorkstreamProvisioning({
			repo,
			projects: workstreamsAggregate.projects,
			takenNames: takenWorkstreamNames(workstreamsAggregate.workstreams),
			...(creation.workstreamId ? { workstreamId: creation.workstreamId } : {}),
		}),
		creation.inBackground === true,
	);
}
