import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';
import { closeBrowserTabCommand } from './close-browser-tab.command';

export { closeBrowserTabsCommand };

function closeBrowserTabsCommand(workstreamId: string): void {
	for (const { tabId } of browserTabsAggregate.tabsOf(workstreamId)) {
		closeBrowserTabCommand({ workstreamId, tabId });
	}
}
