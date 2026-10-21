import type { BrowserState, BrowserTabArgs } from '$contract/browser';
import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';
import { readLastBrowserPage } from '../../infrastructure/services/browser-pages.storage';
import { browserService } from '../../infrastructure/services/browser.service';

export { loadBrowserStateCommand };

function loadBrowserStateCommand(tab: BrowserTabArgs): void {
	void (async () => {
		const state = await currentState(tab);
		const remembered = state.url ? null : readLastBrowserPage(tab);
		if (!remembered) {
			browserStatesAggregate.accept(state);
			return;
		}
		browserStatesAggregate.expect(tab, remembered);
		try {
			await browserService.navigate(tab, remembered);
		} catch {
			browserStatesAggregate.accept(state);
		}
	})();
}

async function currentState(tab: BrowserTabArgs): Promise<BrowserState> {
	try {
		return await browserService.state(tab);
	} catch {
		return {
			...tab,
			url: '',
			title: '',
			favicon: null,
			loading: false,
			canGoBack: false,
			canGoForward: false,
			failure: null,
		};
	}
}
