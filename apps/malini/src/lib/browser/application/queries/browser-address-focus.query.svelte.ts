import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { browserAddressFocusQuery };

class BrowserAddressFocusQuery {
	public readonly data: (tabKey: string) => boolean = $derived((tabKey: string) =>
		browserViewStore.addressFocus.has(tabKey),
	);
}

const browserAddressFocusQuery = new BrowserAddressFocusQuery();
