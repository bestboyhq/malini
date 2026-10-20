import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

import { browserTabPanelId } from '../../domain/browser-tab';
import { addBrowserTabCommand } from './add-browser-tab.command';
import { navigateBrowserCommand } from './navigate-browser.command';

export { openBrowserUrlCommand };

function openBrowserUrlCommand(workstreamId: string, url: string): void {
	const tab = { workstreamId, tabId: crypto.randomUUID() };
	addBrowserTabCommand(tab);
	navigateBrowserCommand(tab, url);
	inspectorPanelCommands.open(workstreamId, browserTabPanelId(tab.tabId));
}
