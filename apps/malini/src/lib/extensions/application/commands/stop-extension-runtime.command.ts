import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

export function stopExtensionRuntimeCommand(): void {
	if (!extensionRuntimeStore.releaseHost()) return;
	setTimeout(releaseUnhostedRuntime, 0);
}

function releaseUnhostedRuntime(): void {
	if (extensionRuntimeStore.isHosted()) return;
	extensionRuntimeStore.runTeardowns();
	void extensionRuntimeStore.release();
}
