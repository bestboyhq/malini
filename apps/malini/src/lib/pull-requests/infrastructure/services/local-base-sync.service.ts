import type { LocalBaseSyncedPayload } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';

class LocalBaseSyncService {
	onSynced(listener: (sync: LocalBaseSyncedPayload) => void): () => void {
		return onPlatformEvent('pull-requests:local-base-synced', listener);
	}
}

export const localBaseSyncService = new LocalBaseSyncService();
