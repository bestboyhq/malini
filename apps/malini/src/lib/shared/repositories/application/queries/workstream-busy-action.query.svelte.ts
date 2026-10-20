import type { WorkstreamActionKind } from '$shared/repositories/domain/workstream-action';
import { workstreamActionsStore } from '$shared/repositories/infrastructure/stores/workstream-actions.store.svelte';

export { workstreamBusyActionQuery };

class WorkstreamBusyActionQuery {
	public readonly data: (workstreamId: string) => WorkstreamActionKind | null = $derived(
		(workstreamId: string) => workstreamActionsStore.busy[workstreamId] ?? null,
	);
}

const workstreamBusyActionQuery = new WorkstreamBusyActionQuery();
