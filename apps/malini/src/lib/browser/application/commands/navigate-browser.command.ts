import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

import { browserFailure } from '../../domain/browser-failure';
import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';
import { browserService } from '../../infrastructure/services/browser.service';
import { loadBrowserStateCommand } from './load-browser-state.command';

export { navigateBrowserCommand };

function navigateBrowserCommand(workstreamId: string, address: string): void {
	const url = address.trim();
	if (!url) return;
	browserStatesAggregate.expect(workstreamId, url);
	void (async () => {
		try {
			await browserService.navigate(workstreamId, url);
		} catch (error) {
			loadBrowserStateCommand(workstreamId);
			toast.error(browserFailure(`Could not open ${url}`, error), aboutWorkstream(workstreamId));
		}
	})();
}
