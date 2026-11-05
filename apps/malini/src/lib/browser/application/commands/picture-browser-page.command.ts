import type { BrowserTabArgs } from '$contract/browser';

import { browserTabKey } from '../../domain/browser-tab';
import { browserService } from '../../infrastructure/services/browser.service';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { pictureBrowserPageCommand };

function pictureBrowserPageCommand(tab: BrowserTabArgs): void {
	const key = browserTabKey(tab);
	const turn = browserViewStore.shownTurn(key);
	if (turn === null) return;
	void (async () => {
		const snapshot = await browserService.snapshot(tab).catch(() => null);
		if (snapshot === null || !browserViewStore.isLatest(key, turn)) return;
		browserViewStore.setSnapshot(key, snapshot);
	})();
}
