import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamSetupEvents } from '$shared/repositories/infrastructure/services/workstream-setup-events.service';

export { abandonWorkstreamProvisioningCommand };

function abandonWorkstreamProvisioningCommand(workstreamId: string): void {
	if (!workstreamProvisioning.get(workstreamId)) return;
	workstreamsAggregate.discardPendingWorkstream(workstreamId);
	workstreamProvisioning.discard(workstreamId);
	workstreamSetupEvents.announce({ workstreamId, status: 'abandoned' });
}
