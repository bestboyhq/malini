import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { provisioningRetryStore } from '$shared/repositories/infrastructure/stores/provisioning-retry.store.svelte';
import { provisionWorkstreamCommand } from './provision-workstream.command';

export { retryProvisioningCommand };

function retryProvisioningCommand(workstreamId: string): void {
	if (provisioningRetryStore.isRetrying(workstreamId)) return;
	const record = workstreamProvisioning.get(workstreamId);
	if (!record) return;
	provisioningRetryStore.begin(workstreamId);
	provisionWorkstreamCommand(record.plan, () => provisioningRetryStore.finish(workstreamId));
}
