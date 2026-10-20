import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { dismissExtensionReadinessToastCommand } from './dismiss-extension-readiness-toast.command';

export function focusExtensionWorkstreamCommand(workstreamId: string): void {
	dismissExtensionReadinessToastCommand();
	extensionRuntimeStore.error = null;
	if (!workstreamId) {
		extensionRuntimeStore.readinessDeadline?.cancel();
		return;
	}
	extensionRuntimeStore.ready = extensionRuntimeStore.service?.workstream?.id === workstreamId;
	extensionRuntimeStore.readinessDeadline?.defer(workstreamId);
	if (extensionRuntimeStore.ready) extensionRuntimeStore.readinessDeadline?.settle(workstreamId);
}
