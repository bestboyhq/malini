import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

import { browserFailure } from '../../domain/browser-failure';
import { browserService } from '../../infrastructure/services/browser.service';

export { goForwardBrowserCommand };

function goForwardBrowserCommand(workstreamId: string): void {
	void (async () => {
		try {
			await browserService.goForward(workstreamId);
		} catch (error) {
			toast.error(browserFailure('Could not go forward', error), aboutWorkstream(workstreamId));
		}
	})();
}
