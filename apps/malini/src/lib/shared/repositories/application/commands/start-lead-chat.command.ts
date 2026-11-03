import type { LeadScope } from '$shared/repositories/domain/lead-scope';
import { planLeadChatProvisioning } from '$shared/repositories/domain/provisioning';
import type { WorkstreamId } from '$shared/repositories/domain/workstream';
import { takenWorkstreamNames } from '$shared/repositories/domain/workstream-names';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { startPlannedWorkstreamCommand } from './start-planned-workstream.command';

export { startLeadChatCommand };

type LeadChatCreation = Readonly<{ workstreamId?: WorkstreamId; inBackground?: boolean }>;

function startLeadChatCommand(scope: LeadScope, creation: LeadChatCreation = {}): void {
	startPlannedWorkstreamCommand(
		planLeadChatProvisioning(
			scope,
			takenWorkstreamNames(workstreamsAggregate.workstreams),
			creation.workstreamId,
		),
		creation.inBackground === true,
	);
}
