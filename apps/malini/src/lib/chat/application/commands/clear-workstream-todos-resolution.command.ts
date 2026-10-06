import { workstreamTodosResolutionStore } from '$lib/chat/infrastructure/stores/workstream-todos-resolution.store.svelte';

export { clearWorkstreamTodosResolutionCommand };

function clearWorkstreamTodosResolutionCommand(requestId: string): void {
	workstreamTodosResolutionStore.clear(requestId);
}
