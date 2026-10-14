import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

import { BROWSER_PANEL_ID } from '../../domain/browser-panel';
import { browserService } from '../../infrastructure/services/browser.service';

export { revealOpenedBrowserHook };

function revealOpenedBrowserHook(): () => void {
	return browserService.onPageOpened(({ workstreamId }) =>
		inspectorPanelCommands.reveal(workstreamId, BROWSER_PANEL_ID),
	);
}
