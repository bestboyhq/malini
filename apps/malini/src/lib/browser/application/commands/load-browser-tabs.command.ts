import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';
import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';
import {
	readBrowserTabs,
	readLastBrowserPage,
} from '../../infrastructure/services/browser-pages.storage';

export { loadBrowserTabsCommand };

function loadBrowserTabsCommand(workstreamId: string): void {
	if (!workstreamId || browserTabsAggregate.has(workstreamId)) return;
	const tabs = readBrowserTabs(workstreamId);
	browserTabsAggregate.set(workstreamId, tabs);
	for (const { tabId } of tabs) {
		const tab = { workstreamId, tabId };
		const url = readLastBrowserPage(tab);
		if (!url) continue;
		browserStatesAggregate.accept({
			...tab,
			url,
			title: '',
			favicon: null,
			loading: false,
			canGoBack: false,
			canGoForward: false,
			failure: null,
		});
	}
}
