import { isWorkstreamCheckoutUsable } from '$shared/repositories/domain/workstream';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamRetirementStore } from '$shared/repositories/infrastructure/stores/workstream-retirement.store.svelte';

export { workstreamReadyForPromptsQuery };

class WorkstreamReadyForPromptsQuery {
	public readonly data: (workstreamId: string) => boolean = $derived((workstreamId: string) => {
		if (workstreamProvisioning.get(workstreamId)) return false;
		if (workstreamRetirementStore.isPending(workstreamId)) return false;
		if (!workstreamsAggregate.loaded || workstreamsAggregate.lastError !== null) return true;
		const workstream = workstreamsAggregate.workstreams.find((entry) => entry.id === workstreamId);
		return workstream !== undefined && isWorkstreamCheckoutUsable(workstream);
	});
}

const workstreamReadyForPromptsQuery = new WorkstreamReadyForPromptsQuery();
