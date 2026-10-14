import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';
import { rememberBrowserPage } from '../../infrastructure/services/browser-pages.storage';
import { browserService } from '../../infrastructure/services/browser.service';

export { watchBrowserStateHook };

function watchBrowserStateHook(): () => void {
	return browserService.onStateChanged((state) => {
		browserStatesAggregate.accept(state);
		rememberBrowserPage(state, state.url);
	});
}
