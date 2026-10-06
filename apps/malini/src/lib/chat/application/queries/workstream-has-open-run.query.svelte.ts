import { openRunsStore } from '$lib/chat/infrastructure/stores/open-runs.store.svelte';

export { workstreamHasOpenRunQuery };

class WorkstreamHasOpenRunQuery {
	public readonly data: (workstreamId: string) => boolean = $derived(
		(workstreamId: string) => openRunsStore.openByWorkstream[workstreamId] ?? false,
	);
}

const workstreamHasOpenRunQuery = new WorkstreamHasOpenRunQuery();
