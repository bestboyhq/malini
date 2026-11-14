import type { WorkstreamProvisioningRecord } from '$shared/repositories/domain/provisioning';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';

export { provisioningRecordQuery };

class ProvisioningRecordQuery {
	public readonly data: (workstreamId: string) => WorkstreamProvisioningRecord | null = $derived(
		(workstreamId: string) => workstreamProvisioning.records[workstreamId] ?? null,
	);

	public readonly madeHere: (workstreamId: string) => boolean = $derived((workstreamId: string) =>
		workstreamProvisioning.madeHere(workstreamId),
	);
}

const provisioningRecordQuery = new ProvisioningRecordQuery();
