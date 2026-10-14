import type { BrowserTabArgs } from '$contract/browser';

import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';
import { saveBrowserTabs } from '../../infrastructure/services/browser-pages.storage';
import { loadBrowserTabsCommand } from './load-browser-tabs.command';

export { addBrowserTabCommand };

function addBrowserTabCommand(tab: BrowserTabArgs): void {
	loadBrowserTabsCommand(tab.workstreamId);
	const tabIds = browserTabsAggregate.tabsOf(tab.workstreamId);
	if (tabIds.includes(tab.tabId)) return;
	const next = [...tabIds, tab.tabId];
	browserTabsAggregate.set(tab.workstreamId, next);
	saveBrowserTabs(tab.workstreamId, next);
}
