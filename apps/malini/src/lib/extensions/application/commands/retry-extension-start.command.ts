import type { ExtensionWorkstream } from '@malini/extension-api';

import { extensionEnablementFailureMessage } from '../../domain/extension-repository-enablement';
import { extensionRepositoryEnablementStore } from '../../infrastructure/stores/extension-repository-enablement.store.svelte';
import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { openInspectorPanelCommand } from './open-inspector-panel.command';

export function retryExtensionStartCommand(input: {
	workstreamId: string;
	workstream: ExtensionWorkstream | null;
	extensionId: string;
	panelId: string | null;
}): void {
	const { workstreamId, workstream, extensionId, panelId } = input;
	if (!workstream || workstream.id !== workstreamId) return;
	const store = extensionRepositoryEnablementStore;
	store.update(workstreamId, extensionId, { changing: true, actionError: null });
	void (async () => {
		try {
			const report = await extensionRuntimeStore
				.coordinator()
				.reloadWorkstreamConfiguration(workstream);
			const failure = report.failed.find(({ id }) => id === extensionId);
			if (failure) throw failure.error;
			if (panelId) openInspectorPanelCommand(workstreamId, panelId);
		} catch (cause) {
			store.update(workstreamId, extensionId, {
				actionError: `Still enabled, but it could not start: ${extensionEnablementFailureMessage(cause)}`,
			});
		} finally {
			store.update(workstreamId, extensionId, { changing: false });
		}
	})();
}
