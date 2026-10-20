import type { BrowserState, BrowserTabArgs } from '$contract/browser';

import { browserTabKey } from '../../domain/browser-tab';

class BrowserStatesAggregate {
	byTab: Readonly<Record<string, BrowserState>> = $state.raw({});
	readonly #leaving = new Map<string, string>();

	accept(state: BrowserState): void {
		const key = browserTabKey(state);
		const current = this.byTab[key];
		const stillLeaving =
			current !== undefined && state.loading && this.#leaving.get(key) === state.url;
		if (!stillLeaving) this.#leaving.delete(key);
		this.#write(stillLeaving ? { ...state, url: current.url } : state);
	}

	expect(tab: BrowserTabArgs, url: string): void {
		const current = this.byTab[browserTabKey(tab)];
		this.#leaving.set(browserTabKey(tab), current?.url ?? '');
		this.#write({
			workstreamId: tab.workstreamId,
			tabId: tab.tabId,
			url,
			title: current?.title ?? '',
			favicon: current?.favicon ?? null,
			loading: true,
			canGoBack: current?.canGoBack ?? false,
			canGoForward: current?.canGoForward ?? false,
		});
	}

	forget(tab: BrowserTabArgs): void {
		const key = browserTabKey(tab);
		this.#leaving.delete(key);
		const { [key]: _forgotten, ...rest } = this.byTab;
		this.byTab = rest;
	}

	#write(state: BrowserState): void {
		this.byTab = { ...this.byTab, [browserTabKey(state)]: state };
	}
}

export const browserStatesAggregate = new BrowserStatesAggregate();
