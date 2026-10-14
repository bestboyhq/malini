import type { BrowserTabArgs } from '$contract/browser';

import { browserService } from '../../infrastructure/services/browser.service';

export { cancelElementPickCommand };

function cancelElementPickCommand(tab: BrowserTabArgs): void {
	void browserService.cancelPick(tab).catch(() => undefined);
}
