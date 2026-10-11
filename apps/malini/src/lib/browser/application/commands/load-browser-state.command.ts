import type { BrowserState } from '$contract/browser';
import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';
import { readLastBrowserPage } from '../../infrastructure/services/browser-pages.storage';
import { browserService } from '../../infrastructure/services/browser.service';

export { loadBrowserStateCommand };

function loadBrowserStateCommand(workstreamId: string): void {
	void (async () => {
		const state = await currentState(workstreamId);
		const remembered = state.url ? null : readLastBrowserPage(workstreamId);
		if (!remembered) {
			browserStatesAggregate.accept(state);
			return;
		}
		browserStatesAggregate.expect(workstreamId, remembered);
		try {
			await browserService.navigate(workstreamId, remembered);
		} catch {
			browserStatesAggregate.accept(state);
		}
	})();
}

async function currentState(workstreamId: string): Promise<BrowserState> {
	try {
		return await browserService.state(workstreamId);
	} catch {
		return {
			workstreamId,
			url: '',
			title: '',
			loading: false,
			canGoBack: false,
			canGoForward: false,
		};
	}
}
