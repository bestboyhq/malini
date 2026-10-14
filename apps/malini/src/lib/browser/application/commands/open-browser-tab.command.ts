import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

import { browserTabPanelId } from '../../domain/browser-tab';
import { addBrowserTabCommand } from './add-browser-tab.command';

export { openBrowserTabCommand };

function openBrowserTabCommand(workstreamId: string): void {
	const tabId = crypto.randomUUID();
	addBrowserTabCommand({ workstreamId, tabId });
	inspectorPanelCommands.open(workstreamId, browserTabPanelId(tabId));
}
