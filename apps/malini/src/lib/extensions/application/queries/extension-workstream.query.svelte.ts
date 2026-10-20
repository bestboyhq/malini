import type { ExtensionWorkstream } from '@malini/extension-api';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

class ExtensionWorkstreamQuery {
	public readonly data: ExtensionWorkstream | null = $derived(
		extensionRuntimeStore.activeWorkstream,
	);
}

export const extensionWorkstreamQuery = new ExtensionWorkstreamQuery();
