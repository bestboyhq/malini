import type { ExtensionWorkstream } from '@malini/extension-api';
import { scheduleAfterSettledNavigationPaint } from '$shared/performance/navigation-paint-scheduler';

import { extensionWorkstreamFingerprint } from '../../domain/extension-workstream-fingerprint';
import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { publishAutomationRunOptionsCommand } from './publish-automation-run-options.command';

export function warmExtensionRuntimeCommand(workstream: ExtensionWorkstream): void {
	const service = extensionRuntimeStore.service;
	if (!service || service.workstream || extensionRuntimeStore.requestedWorkstreamFingerprint)
		return;
	const coordinator = extensionRuntimeStore.coordinator();
	const fingerprint = extensionWorkstreamFingerprint(workstream);
	extensionRuntimeStore.requestedWorkstreamFingerprint = fingerprint;
	extensionRuntimeStore.requestedInBackground = true;
	const generation = ++extensionRuntimeStore.activationGeneration;
	const warming = (): boolean =>
		generation === extensionRuntimeStore.activationGeneration &&
		extensionRuntimeStore.requestedWorkstreamFingerprint === fingerprint;

	const cancelWarm = scheduleAfterSettledNavigationPaint(() => {
		if (!warming()) return;
		void (async () => {
			let failed: boolean;
			try {
				failed = (await coordinator.activate(workstream)).failed.length > 0;
			} catch {
				failed = true;
			}
			const active = extensionRuntimeStore.service?.workstream ?? null;
			extensionRuntimeStore.activeWorkstream = active ? { ...active } : null;
			if (!warming()) return;
			extensionRuntimeStore.requestedInBackground = false;
			if (failed) {
				extensionRuntimeStore.requestedWorkstreamFingerprint = null;
				return;
			}
			extensionRuntimeStore.workstreamRevision += 1;
			extensionRuntimeStore.ready = true;
			publishAutomationRunOptionsCommand();
		})();
	});
	extensionRuntimeStore.registerTeardown(cancelWarm);
}
