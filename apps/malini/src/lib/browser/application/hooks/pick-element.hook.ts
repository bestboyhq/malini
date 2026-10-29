import type { BrowserTabArgs } from '$contract/browser';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import {
	DEFAULT_AGENT_RUN_PROFILE,
	agentAccessDefaultQuery,
	defaultAgentModel,
	modelCatalogQuery,
	pickerModels,
} from '$shared/providers/providers.api';

import { browserFailure } from '../../domain/browser-failure';
import { browserTabKey } from '../../domain/browser-tab';
import { browserService } from '../../infrastructure/services/browser.service';
import {
	readInlineModel,
	rememberInlineModel,
} from '../../infrastructure/services/inline-model.storage';
import { browserViewStore } from '../../infrastructure/stores/browser-view.store.svelte';

export { pickElementHook };

function pickElementHook(): (tab: BrowserTabArgs) => void {
	return (tab) => {
		const key = browserTabKey(tab);
		if (browserViewStore.picking.has(key)) return;
		browserViewStore.setPicking(key, true);
		const model = readInlineModel() ?? defaultAgentModel();
		void (async () => {
			try {
				const started = await browserService.pickElement({
					...tab,
					model,
					models: pickerModels(modelCatalogQuery.data, model).map(({ id, label }) => ({
						id,
						label,
					})),
					profile: {
						...DEFAULT_AGENT_RUN_PROFILE,
						access: agentAccessDefaultQuery.data,
						report: 'low',
					},
				});
				if (started) rememberInlineModel(started.model);
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
