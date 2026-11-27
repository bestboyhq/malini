import { DEFAULT_BROWSER_PROFILE } from '$contract/browser';
import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

import { browserPanelId } from '../../domain/browser-tab';
import { browserDeckStore } from '../../infrastructure/stores/browser-deck.store.svelte';
import { addBrowserTabCommand } from './add-browser-tab.command';
import { navigateBrowserCommand } from './navigate-browser.command';

export { openBrowserUrlCommand };

function openBrowserUrlCommand(workstreamId: string, url: string): void {
	const tab = { workstreamId, tabId: crypto.randomUUID() };
	addBrowserTabCommand({ ...tab, profile: DEFAULT_BROWSER_PROFILE });
	navigateBrowserCommand(tab, url);
	inspectorPanelCommands.open(workstreamId, browserPanelId(tab.tabId, browserDeckStore.on));
}
