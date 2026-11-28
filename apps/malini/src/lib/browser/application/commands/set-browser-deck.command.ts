import { inspectorPanelCommands } from '$shared/extensions/panel-requests.store.svelte';

import { browserPanelId } from '../../domain/browser-tab';
import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';
import { browserDeckStore } from '../../infrastructure/stores/browser-deck.store.svelte';

export { setBrowserDeckCommand };

function setBrowserDeckCommand(workstreamId: string, on: boolean, tabId?: string): void {
	browserDeckStore.set(on);
	const shown = tabId ?? browserTabsAggregate.tabsOf(workstreamId)[0]?.tabId;
	if (shown) inspectorPanelCommands.open(workstreamId, browserPanelId(shown, on));
}
