import type { BrowserTabArgs } from '$contract/browser';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

import { browserFailure } from '../../domain/browser-failure';
import { browserService } from '../../infrastructure/services/browser.service';

export { reloadBrowserCommand };

function reloadBrowserCommand(tab: BrowserTabArgs): void {
	void (async () => {
		try {
			await browserService.reload(tab);
		} catch (error) {
			toast.error(
				browserFailure('Could not reload the page', error),
				aboutWorkstream(tab.workstreamId),
			);
		}
	})();
}
