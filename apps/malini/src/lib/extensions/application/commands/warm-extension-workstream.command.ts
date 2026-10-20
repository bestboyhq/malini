import type { ExtensionWorkstream } from '@malini/extension-api';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

export function warmExtensionWorkstreamCommand(workstream: ExtensionWorkstream): void {
	const service = extensionRuntimeStore.service;
	const active = service?.workstream;
	if (!service || !active || active.id === workstream.id) return;
	void (async () => {
		try {
			await service.host.contributions.executeCommand('malini.repository.warm-workstream', {
				...workstream,
			});
		} catch {
			return;
		}
	})();
}
