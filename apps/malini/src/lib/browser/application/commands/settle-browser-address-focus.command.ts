import type { BrowserTabArgs } from '$contract/browser';

import { browserTabKey } from '../../domain/browser-tab';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { settleBrowserAddressFocusCommand };

function settleBrowserAddressFocusCommand(tab: BrowserTabArgs): void {
	browserViewStore.setAddressFocus(browserTabKey(tab), false);
}
