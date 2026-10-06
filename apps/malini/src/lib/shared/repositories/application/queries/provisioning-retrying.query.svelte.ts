import { provisioningRetryStore } from '$shared/repositories/infrastructure/stores/provisioning-retry.store.svelte';

export { provisioningRetryingQuery };

class ProvisioningRetryingQuery {
	public readonly data: (workstreamId: string) => boolean = $derived((workstreamId: string) =>
		provisioningRetryStore.isRetrying(workstreamId),
	);
}

const provisioningRetryingQuery = new ProvisioningRetryingQuery();
