import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { localBaseSyncNotice } from '$lib/pull-requests/domain/local-base-sync';
import { localBaseSyncService } from '$lib/pull-requests/infrastructure/services/local-base-sync.service';

export function announceLocalBaseSyncHook(): () => void {
	return localBaseSyncService.onSynced((sync) => {
		const { level, message } = localBaseSyncNotice(sync);
		toast[level](message, sync.workstreamId ? aboutWorkstream(sync.workstreamId) : {});
	});
}
