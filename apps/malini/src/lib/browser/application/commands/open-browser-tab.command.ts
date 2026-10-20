import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

import { browserTabKey, browserTabPanelId } from '../../domain/browser-tab';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';
import { addBrowserTabCommand } from './add-browser-tab.command';

export { openBrowserTabCommand };

function openBrowserTabCommand(workstreamId: string): void {
	const tab = { workstreamId, tabId: crypto.randomUUID() };
	addBrowserTabCommand(tab);
	browserViewStore.setAddressFocus(browserTabKey(tab), true);
	inspectorPanelCommands.open(workstreamId, browserTabPanelId(tab.tabId));
}
