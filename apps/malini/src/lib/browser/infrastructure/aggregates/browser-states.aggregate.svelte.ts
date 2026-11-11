import type { BrowserState, BrowserTabArgs } from '$contract/browser';

import { browserTabKey } from '../../domain/browser-tab';

class BrowserStatesAggregate {
	byTab: Readonly<Record<string, BrowserState>> = $state.raw({});

	accept(state: BrowserState): void {
		this.byTab = { ...this.byTab, [browserTabKey(state)]: state };
	}

	expect(tab: BrowserTabArgs, url: string): void {
		const current = this.byTab[browserTabKey(tab)];
		this.accept({
			workstreamId: tab.workstreamId,
			tabId: tab.tabId,
			url,
			title: current?.title ?? '',
			favicon: current?.favicon ?? null,
			loading: true,
			canGoBack: current?.canGoBack ?? false,
			canGoForward: current?.canGoForward ?? false,
			failure: null,
		});
	}

	forget(tab: BrowserTabArgs): void {
		const key = browserTabKey(tab);
		const { [key]: _forgotten, ...rest } = this.byTab;
		this.byTab = rest;
	}
}

export const browserStatesAggregate = new BrowserStatesAggregate();
