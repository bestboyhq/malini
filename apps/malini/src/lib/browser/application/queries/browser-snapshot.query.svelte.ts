import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { browserSnapshotQuery };

class BrowserSnapshotQuery {
	public readonly data: (workstreamId: string) => string | null = $derived(
		(workstreamId: string) => browserViewStore.snapshots[workstreamId] ?? null,
	);
}

const browserSnapshotQuery = new BrowserSnapshotQuery();
