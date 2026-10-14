import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { browserPickingQuery };

class BrowserPickingQuery {
	public readonly data: (tabKey: string) => boolean = $derived((tabKey: string) =>
		browserViewStore.picking.has(tabKey),
	);
}

const browserPickingQuery = new BrowserPickingQuery();
