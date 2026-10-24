import type { LeadScope } from '$shared/repositories/domain/lead-scope';
import { planLeadChatProvisioning } from '$shared/repositories/domain/provisioning';
import { takenWorkstreamNames } from '$shared/repositories/domain/workstream-names';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { startPlannedWorkstreamCommand } from './start-planned-workstream.command';

export { startLeadChatCommand };

function startLeadChatCommand(scope: LeadScope): void {
	startPlannedWorkstreamCommand(
		planLeadChatProvisioning(scope, takenWorkstreamNames(workstreamsAggregate.workstreams)),
	);
}
