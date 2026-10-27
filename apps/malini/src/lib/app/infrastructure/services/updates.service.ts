import { APP_UPDATE_STATUS_CHANGED_CHANNEL, type UpdateStatus } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class UpdatesService {
	status(): Promise<UpdateStatus> {
		return invoke('app.update-status', undefined);
	}

	onStatus(listener: (status: UpdateStatus) => void): () => void {
		return onPlatformEvent(APP_UPDATE_STATUS_CHANGED_CHANNEL, listener);
	}

	check(): Promise<void> {
		return invoke('app.check-for-updates', undefined);
	}

	restart(): Promise<void> {
		return invoke('app.restart-to-update', undefined);
	}
}

export const updatesService = new UpdatesService();
