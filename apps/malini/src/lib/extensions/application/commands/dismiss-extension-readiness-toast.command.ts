import { toast } from '$hyper-ui/components/toast';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

export function dismissExtensionReadinessToastCommand(workstreamId?: string): void {
	const current = extensionRuntimeStore.readinessToast;
	if (!current || (workstreamId && current.workstreamId !== workstreamId)) return;
	toast.dismiss(current.id);
	extensionRuntimeStore.readinessToast = null;
}
