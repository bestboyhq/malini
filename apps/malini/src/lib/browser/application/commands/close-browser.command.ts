import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';
import { forgetBrowserPage } from '../../infrastructure/services/browser-pages.storage';
import { browserService } from '../../infrastructure/services/browser.service';

export { closeBrowserCommand };

function closeBrowserCommand(workstreamId: string): void {
	void (async () => {
		await browserService.close(workstreamId).catch(() => undefined);
		forgetBrowserPage(workstreamId);
		browserStatesAggregate.forget(workstreamId);
	})();
}
