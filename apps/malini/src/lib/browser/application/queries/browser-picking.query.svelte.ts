import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { browserPickingQuery };

class BrowserPickingQuery {
	public readonly data: (workstreamId: string) => boolean = $derived((workstreamId: string) =>
		browserViewStore.picking.has(workstreamId),
	);
}

const browserPickingQuery = new BrowserPickingQuery();
