import {
	workstreamNativeExistence,
	type WorkstreamNativeExistence,
} from '$shared/repositories/domain/provisioning';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';

export { workstreamNativeExistenceQuery };

class WorkstreamNativeExistenceQuery {
	public readonly data: (workstreamId: string) => WorkstreamNativeExistence = $derived(
		(workstreamId: string) =>
			workstreamNativeExistence(workstreamProvisioning.records[workstreamId] ?? null),
	);
}

const workstreamNativeExistenceQuery = new WorkstreamNativeExistenceQuery();
