import { browserDeckStore } from '../../infrastructure/stores/browser-deck.store.svelte';

export { browserDeckQuery };

class BrowserDeckQuery {
	public readonly data: boolean = $derived(browserDeckStore.on);
}

const browserDeckQuery = new BrowserDeckQuery();
