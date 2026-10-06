import type { WorkstreamTodosResolution } from '$lib/chat/domain/workstream-todos';
import { workstreamTodosResolutionStore } from '$lib/chat/infrastructure/stores/workstream-todos-resolution.store.svelte';

export { workstreamTodosResolutionQuery };

class WorkstreamTodosResolutionQuery {
	public readonly data: WorkstreamTodosResolution | null = $derived(
		workstreamTodosResolutionStore.resolution,
	);
}

const workstreamTodosResolutionQuery = new WorkstreamTodosResolutionQuery();
