import { DEFAULT_BROWSER_PROFILE } from '$contract/browser';
import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

import { browserPanelId, browserTabKey } from '../../domain/browser-tab';
import { browserDeckStore } from '../../infrastructure/stores/browser-deck.store.svelte';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';
import { addBrowserTabCommand } from './add-browser-tab.command';

export { openBrowserTabCommand };

function openBrowserTabCommand(workstreamId: string, profile = DEFAULT_BROWSER_PROFILE): void {
	const tab = { workstreamId, tabId: crypto.randomUUID() };
	addBrowserTabCommand({ ...tab, profile });
	browserViewStore.setAddressFocus(browserTabKey(tab), true);
	inspectorPanelCommands.open(workstreamId, browserPanelId(tab.tabId, browserDeckStore.on));
}
