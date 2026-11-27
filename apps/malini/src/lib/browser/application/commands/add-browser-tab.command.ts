import type { BrowserTabOpened } from '$contract/browser';

import { browserProfilesAggregate } from '../../infrastructure/aggregates/browser-profiles.aggregate.svelte';
import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';
import { saveBrowserTabs } from '../../infrastructure/services/browser-pages.storage';
import { loadBrowserTabsCommand } from './load-browser-tabs.command';

export { addBrowserTabCommand };

function addBrowserTabCommand({ workstreamId, tabId, profile }: BrowserTabOpened): void {
	loadBrowserTabsCommand(workstreamId);
	browserProfilesAggregate.add([profile]);
	const tabs = browserTabsAggregate.tabsOf(workstreamId);
	if (tabs.some((tab) => tab.tabId === tabId)) return;
	const next = [...tabs, { tabId, profile }];
	browserTabsAggregate.set(workstreamId, next);
	saveBrowserTabs(workstreamId, next);
}
