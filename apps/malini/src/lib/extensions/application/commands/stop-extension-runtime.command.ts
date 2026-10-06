import { automationRulesStore } from '$shared/extensions/automation-rules.store.svelte';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

export function stopExtensionRuntimeCommand(): void {
	if (!extensionRuntimeStore.releaseHost()) return;
	setTimeout(releaseUnhostedRuntime, 0);
}

function releaseUnhostedRuntime(): void {
	if (extensionRuntimeStore.isHosted()) return;
	extensionRuntimeStore.runTeardowns();
	automationRulesStore.publishRunOptions(null);
	automationRulesStore.publishFailures([]);
	void extensionRuntimeStore.release();
}
