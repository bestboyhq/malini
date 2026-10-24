import { tick } from 'svelte';
import type { BrowserTabArgs } from '$contract/browser';
import { inspectorWidth } from '$shared/extensions/inspector-width.store';

import { browserTabKey } from '../../domain/browser-tab';
import { browserService } from '../../infrastructure/services/browser.service';

export { watchBrowserResizesHook };

function watchBrowserResizesHook(
	tab: BrowserTabArgs,
	shownWidth: () => number | null,
	place: () => void,
): () => void {
	return browserService.onResizeRequested((request) => {
		if (browserTabKey(request) !== browserTabKey(tab)) return;
		const shown = shownWidth();
		if (shown === null) return;
		inspectorWidth.grow(tab.workstreamId, request.width - shown);
		void (async () => {
			await tick();
			place();
			try {
				await browserService.resized(request.requestId);
			} catch {
				return;
			}
		})();
	});
}
