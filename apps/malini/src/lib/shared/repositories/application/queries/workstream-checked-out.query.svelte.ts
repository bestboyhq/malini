import { workstreamNativeExistence } from '$shared/repositories/domain/provisioning';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { workstreamCheckedOutQuery };

class WorkstreamCheckedOutQuery {
	public readonly data: (workstreamId: string) => boolean = $derived(
		(workstreamId: string) =>
			workstreamsAggregate.workstreams.some(
				(workstream) => workstream.id === workstreamId && workstream.status !== 'archived',
			) && workstreamNativeExistence(workstreamProvisioning.get(workstreamId)) === 'platform',
	);
}

const workstreamCheckedOutQuery = new WorkstreamCheckedOutQuery();
