import type { ExtensionPanelRegistration } from '@malini/extension-api';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

class InspectorPanelsQuery {
	public readonly data: readonly ExtensionPanelRegistration[] = $derived(
		extensionRuntimeStore.panels,
	);
}

export const inspectorPanelsQuery = new InspectorPanelsQuery();
