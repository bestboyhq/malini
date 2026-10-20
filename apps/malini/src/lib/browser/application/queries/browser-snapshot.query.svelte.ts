import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { browserSnapshotQuery };

class BrowserSnapshotQuery {
	public readonly data: (tabKey: string) => string | null = $derived(
		(tabKey: string) => browserViewStore.snapshots[tabKey] ?? null,
	);
}

const browserSnapshotQuery = new BrowserSnapshotQuery();
