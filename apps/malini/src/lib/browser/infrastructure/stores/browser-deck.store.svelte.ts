import { readBrowserDeck, saveBrowserDeck } from '../services/browser-pages.storage';

class BrowserDeckStore {
	on: boolean = $state(readBrowserDeck());

	set(on: boolean): void {
		if (this.on === on) return;
		this.on = on;
		saveBrowserDeck(on);
	}
}

export const browserDeckStore = new BrowserDeckStore();
