import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { localBaseSyncWarning } from '$lib/pull-requests/domain/local-base-sync';
import { localBaseSyncService } from '$lib/pull-requests/infrastructure/services/local-base-sync.service';

export function announceLocalBaseSyncHook(): () => void {
	return localBaseSyncService.onSynced((sync) => {
		const warning = localBaseSyncWarning(sync);
		if (warning)
			toast.warning(warning, sync.workstreamId ? aboutWorkstream(sync.workstreamId) : {});
	});
}
