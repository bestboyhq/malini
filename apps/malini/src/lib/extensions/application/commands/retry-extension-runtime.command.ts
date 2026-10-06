import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';
import { dismissExtensionReadinessToastCommand } from './dismiss-extension-readiness-toast.command';

export function retryExtensionRuntimeCommand(workstreamId: string): void {
	if (!workstreamId) return;
	extensionRuntimeStore.error = null;
	dismissExtensionReadinessToastCommand(workstreamId);
	extensionRuntimeStore.ready = extensionRuntimeStore.service?.workstream?.id === workstreamId;
	extensionRuntimeStore.requestedWorkstreamFingerprint = null;
	extensionRuntimeStore.requestedInBackground = false;
	extensionRuntimeStore.readinessDeadline?.defer(workstreamId);
	extensionRuntimeStore.activationRetryRevision += 1;
}
