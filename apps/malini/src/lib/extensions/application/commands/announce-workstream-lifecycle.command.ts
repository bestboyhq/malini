import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

import { extensionRuntimeStore } from '../../infrastructure/stores/extension-runtime.store.svelte';

export function announceWorkstreamLifecycleCommand(
	action: 'archived' | 'deleted',
	workstreamId: string,
): void {
	if (!extensionRuntimeStore.isMounted()) {
		extensionRuntimeStore.deferLifecycle({ action, workstreamId });
		return;
	}
	void (async () => {
		try {
			const coordinator = extensionRuntimeStore.coordinator();
			if (action === 'archived') await coordinator.announceWorkstreamArchived(workstreamId);
			else await coordinator.announceWorkstreamDeleted(workstreamId);
		} catch (cause) {
			toast.warning(
				`Workstream ${action}, but its extension cleanup needs attention · ${cleanupFailure(cause)}`,
				aboutWorkstream(workstreamId),
			);
		}
	})();
}

function cleanupFailure(cause: unknown): string {
	if (cause instanceof Error && cause.message.trim()) return cause.message;
	if (typeof cause === 'string' && cause.trim()) return cause;
	return 'An extension did not finish its workstream cleanup';
}
