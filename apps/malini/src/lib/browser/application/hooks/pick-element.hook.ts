import type { BrowserElementPrompt } from '$contract/browser';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

import { browserFailure } from '../../domain/browser-failure';
import { browserService } from '../../infrastructure/services/browser.service';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { pickElementHook };

function pickElementHook(
	onPicked: (workstreamId: string, picked: BrowserElementPrompt) => void,
): (workstreamId: string) => void {
	return (workstreamId) => {
		if (browserViewStore.picking.has(workstreamId)) return;
		browserViewStore.setPicking(workstreamId, true);
		void (async () => {
			try {
				const picked = await browserService.pickElement(workstreamId);
				if (picked) onPicked(workstreamId, picked);
			} catch (error) {
				toast.error(
					browserFailure('Could not pick an element', error),
					aboutWorkstream(workstreamId),
				);
			} finally {
				browserViewStore.setPicking(workstreamId, false);
			}
		})();
	};
}
