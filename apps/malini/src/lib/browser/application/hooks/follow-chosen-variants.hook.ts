import { variantChoices } from '$shared/variants/variant-choices.store.svelte';

import { browserTabKey } from '../../domain/browser-tab';
import { chosenVariantPage } from '../../domain/variant-pages';
import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';
import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';
import { navigateBrowserCommand } from '../commands/navigate-browser.command';

export { followChosenVariantsHook };

function followChosenVariantsHook(): () => void {
	return variantChoices.onChosen(({ workstreamId, variants, chosen }) => {
		for (const tabId of browserTabsAggregate.tabsOf(workstreamId)) {
			const tab = { workstreamId, tabId };
			const url = browserStatesAggregate.byTab[browserTabKey(tab)]?.url ?? '';
			const page = chosenVariantPage(url, workstreamId, variants, chosen.id);
			if (page) navigateBrowserCommand(tab, page);
		}
	});
}
