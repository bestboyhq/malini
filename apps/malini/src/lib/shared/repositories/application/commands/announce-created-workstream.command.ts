import type { Workstream } from '$shared/repositories/domain/workstream';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamSetupEvents } from '$shared/repositories/infrastructure/services/workstream-setup-events.service';

export { announceCreatedWorkstreamCommand };

function announceCreatedWorkstreamCommand(workstream: Workstream): void {
	if (workstreamProvisioning.get(workstream.id)) return;
	if (!workstreamsAggregate.workstreams.some((entry) => entry.id === workstream.id)) {
		workstreamsAggregate.upsert(workstream);
	}
	workstreamSetupEvents.announce({ workstreamId: workstream.id, status: 'ready' });
}
