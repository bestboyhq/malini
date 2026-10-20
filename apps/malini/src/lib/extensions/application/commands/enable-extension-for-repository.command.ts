import type { ExtensionWorkstream } from '@malini/extension-api';

import { extensionEnablementFailureMessage } from '../../domain/extension-repository-enablement';
import { extensionConfigurationWriterService } from '../../infrastructure/services/extension-configuration-writer.service';
import { extensionRepositoryEnablementStore } from '../../infrastructure/stores/extension-repository-enablement.store.svelte';
import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { openInspectorPanelCommand } from './open-inspector-panel.command';

export function enableExtensionForRepositoryCommand(input: {
	workstreamId: string;
	workstream: ExtensionWorkstream | null;
	extensionId: string;
	panelId: string | null;
}): void {
	const { workstreamId, workstream, extensionId, panelId } = input;
	const store = extensionRepositoryEnablementStore;
	if (!workstream || workstream.id !== workstreamId) {
		store.update(workstreamId, extensionId, {
			actionError: 'This repository is still opening. Try again in a moment.',
		});
		return;
	}
	store.update(workstreamId, extensionId, { changing: true, actionError: null });
	void (async () => {
		try {
			await extensionConfigurationWriterService.setEnabled(workstream.id, extensionId, true);
			store.update(workstreamId, extensionId, { enabled: true });
			const report = await extensionRuntimeStore
				.coordinator()
				.reloadWorkstreamConfiguration(workstream);
			const failure = report.failed.find(({ id }) => id === extensionId);
			if (failure) throw failure.error;
			if (panelId) openInspectorPanelCommand(workstreamId, panelId);
		} catch (cause) {
			const message = extensionEnablementFailureMessage(cause);
			store.update(workstreamId, extensionId, {
				actionError: store.get(workstreamId, extensionId).enabled
					? `Enabled for this repository, but it could not start: ${message}`
					: message,
			});
		} finally {
			store.update(workstreamId, extensionId, { changing: false });
		}
	})();
}
