import { APP_UPDATE_STAGED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class UpdatesService {
	staged(): Promise<string | null> {
		return invoke('app.staged-update', undefined);
	}

	onStaged(listener: (version: string) => void): () => void {
		return onPlatformEvent(APP_UPDATE_STAGED_CHANNEL, ({ version }) => listener(version));
	}

	restart(): Promise<void> {
		return invoke('app.restart-to-update', undefined);
	}
}

export const updatesService = new UpdatesService();
