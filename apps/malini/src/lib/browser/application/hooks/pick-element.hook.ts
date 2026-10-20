import type { BrowserElementPrompt, BrowserTabArgs } from '$contract/browser';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

import { browserFailure } from '../../domain/browser-failure';
import { browserTabKey } from '../../domain/browser-tab';
import { browserService } from '../../infrastructure/services/browser.service';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { pickElementHook };

function pickElementHook(
	onPicked: (workstreamId: string, picked: BrowserElementPrompt) => void,
): (tab: BrowserTabArgs) => void {
	return (tab) => {
		const key = browserTabKey(tab);
		if (browserViewStore.picking.has(key)) return;
		browserViewStore.setPicking(key, true);
		void (async () => {
			try {
				const picked = await browserService.pickElement(tab);
				if (picked) onPicked(tab.workstreamId, picked);
			} catch (error) {
				toast.error(
					browserFailure('Could not pick an element', error),
					aboutWorkstream(tab.workstreamId),
				);
			} finally {
				browserViewStore.setPicking(key, false);
			}
		})();
	};
}
