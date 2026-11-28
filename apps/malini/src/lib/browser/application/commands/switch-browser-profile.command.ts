import type { BrowserTabArgs } from '$contract/browser';

import { browserTabKey } from '../../domain/browser-tab';
import { browserProfilesAggregate } from '../../infrastructure/aggregates/browser-profiles.aggregate.svelte';
import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';
import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';
import { saveBrowserTabs } from '../../infrastructure/services/browser-pages.storage';
import { navigateBrowserCommand } from './navigate-browser.command';

export { switchBrowserProfileCommand };

function switchBrowserProfileCommand(tab: BrowserTabArgs, profile: string): void {
	if (browserTabsAggregate.profileOf(tab) === profile) return;
	const next = browserTabsAggregate
		.tabsOf(tab.workstreamId)
		.map((entry) => (entry.tabId === tab.tabId ? { tabId: entry.tabId, profile } : entry));
	browserTabsAggregate.set(tab.workstreamId, next);
	saveBrowserTabs(tab.workstreamId, next);
	browserProfilesAggregate.add([profile]);
	const url = browserStatesAggregate.byTab[browserTabKey(tab)]?.url ?? '';
	if (url) navigateBrowserCommand(tab, url);
}
