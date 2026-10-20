import type {
	ExtensionPanelContext,
	ExtensionSettingValue,
	ExtensionWorkstream,
} from '@malini/extension-api';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

class ExtensionPanelContextQuery {
	public readonly data: (workstream: ExtensionWorkstream | null) => ExtensionPanelContext =
		$derived((workstream: ExtensionWorkstream | null) => {
			extensionRuntimeStore.settingsRevision;
			extensionRuntimeStore.workstreamRevision;
			const service = extensionRuntimeStore.service;
			const settings: Record<string, ExtensionSettingValue> = {};
			if (service) {
				for (const definition of service.host.contributions.listSettings()) {
					try {
						settings[definition.id] = service.host.contributions.getSetting(definition.id);
					} catch {
						settings[definition.id] = definition.default;
					}
				}
			}
			return {
				workstream,
				settings,
				async executeCommand(id: string, ...args: readonly unknown[]): Promise<unknown> {
					if (!service) throw new Error('Extensions are not ready yet');
					if (workstream && service.workstream?.id !== workstream.id) {
						throw new Error('Extensions are running for another workstream');
					}
					return service.host.contributions.executeCommand(id, ...args);
				},
			};
		});
}

export const extensionPanelContextQuery = new ExtensionPanelContextQuery();
