import { publishFlowStore } from '$lib/stats/infrastructure/stores/publish-flow.store.svelte';

export { editHandleCommand };

function editHandleCommand(handle: string): void {
	publishFlowStore.edit(handle);
}
