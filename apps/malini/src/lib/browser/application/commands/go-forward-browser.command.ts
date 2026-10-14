import type { BrowserTabArgs } from '$contract/browser';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

import { browserFailure } from '../../domain/browser-failure';
import { browserService } from '../../infrastructure/services/browser.service';

export { goForwardBrowserCommand };

function goForwardBrowserCommand(tab: BrowserTabArgs): void {
	void (async () => {
		try {
			await browserService.goForward(tab);
		} catch (error) {
			toast.error(browserFailure('Could not go forward', error), aboutWorkstream(tab.workstreamId));
		}
	})();
}
