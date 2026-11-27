import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

import { browserPanelId } from '../../domain/browser-tab';
import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';
import { browserService } from '../../infrastructure/services/browser.service';
import { browserDeckStore } from '../../infrastructure/stores/browser-deck.store.svelte';
import { addBrowserTabCommand } from '../commands/add-browser-tab.command';

export { revealOpenedBrowserHook };

function revealOpenedBrowserHook(): () => void {
	return browserService.onTabOpened((tab) => {
		addBrowserTabCommand(tab);
		const tabs = browserTabsAggregate.tabsOf(tab.workstreamId);
		if (new Set(tabs.map(({ profile }) => profile)).size > 1) browserDeckStore.set(true);
		inspectorPanelCommands.reveal(tab.workstreamId, browserPanelId(tab.tabId, browserDeckStore.on));
	});
}
