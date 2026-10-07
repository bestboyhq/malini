import { runStartsStore } from '$lib/chat/infrastructure/stores/run-starts.store.svelte';

export { observeRunStartCommand };

function observeRunStartCommand(runId: string): void {
	runStartsStore.observe(runId, Date.now());
}
