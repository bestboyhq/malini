import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

import { browserTabPanelId } from '../../domain/browser-tab';
import { browserService } from '../../infrastructure/services/browser.service';
import { addBrowserTabCommand } from '../commands/add-browser-tab.command';

export { revealOpenedBrowserHook };

function revealOpenedBrowserHook(): () => void {
	return browserService.onTabOpened((tab) => {
		addBrowserTabCommand(tab);
		inspectorPanelCommands.reveal(tab.workstreamId, browserTabPanelId(tab.tabId));
	});
}
