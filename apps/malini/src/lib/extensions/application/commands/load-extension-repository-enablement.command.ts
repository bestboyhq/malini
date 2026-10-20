import { captureRendererError } from '$shared/errors/renderer-error-sink';

import { bundledExtensionActivation } from '../../domain/bundled-extension-activation';
import { extensionEnablementFailureMessage } from '../../domain/extension-repository-enablement';
import { extensionConfigurationReaderService } from '../../infrastructure/services/extension-configuration-reader.service';
import { extensionRepositoryEnablementStore } from '../../infrastructure/stores/extension-repository-enablement.store.svelte';

export function loadExtensionRepositoryEnablementCommand(
	workstreamId: string,
	extensionId: string,
): void {
	const store = extensionRepositoryEnablementStore;
	const generation = store.beginLoad(workstreamId, extensionId);
	if (bundledExtensionActivation(extensionId) !== 'workstream' || !workstreamId) {
		store.update(workstreamId, extensionId, { enabled: false, loading: false, error: null });
		return;
	}
	store.update(workstreamId, extensionId, { loading: true, error: null, actionError: null });
	void (async () => {
		try {
			const loaded = await extensionConfigurationReaderService.load(workstreamId);
			if (!store.isCurrentLoad(workstreamId, extensionId, generation)) return;
			store.update(workstreamId, extensionId, {
				enabled: loaded.configuration.extensions[extensionId]?.enabled === true,
				loading: false,
			});
		} catch (cause) {
			if (!store.isCurrentLoad(workstreamId, extensionId, generation)) return;
			const message = extensionEnablementFailureMessage(cause);
			store.update(workstreamId, extensionId, {
				loading: false,
				error: message,
				actionError: message,
			});
			captureRendererError('caught', cause);
		}
	})();
}
