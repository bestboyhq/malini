import type { BrowserTabArgs } from '$contract/browser';

import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';
import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';
import {
	forgetBrowserPage,
	saveBrowserTabs,
} from '../../infrastructure/services/browser-pages.storage';
import { browserService } from '../../infrastructure/services/browser.service';

export { closeBrowserTabCommand };

function closeBrowserTabCommand(tab: BrowserTabArgs): void {
	const remaining = browserTabsAggregate
		.tabsOf(tab.workstreamId)
		.filter((tabId) => tabId !== tab.tabId);
	browserTabsAggregate.set(tab.workstreamId, remaining);
	saveBrowserTabs(tab.workstreamId, remaining);
	void (async () => {
		await browserService.close(tab).catch(() => undefined);
		forgetBrowserPage(tab);
		browserStatesAggregate.forget(tab);
	})();
}
