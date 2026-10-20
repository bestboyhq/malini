import { runStartsStore } from '$lib/chat/infrastructure/stores/run-starts.store.svelte';

export { runStartedAtQuery };

class RunStartedAtQuery {
	public readonly data: (runId: string) => number | null = $derived(
		(runId: string) => runStartsStore.startedAtByRun[runId] ?? null,
	);
}

const runStartedAtQuery = new RunStartedAtQuery();
