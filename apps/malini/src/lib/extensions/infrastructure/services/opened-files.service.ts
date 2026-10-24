import {
	EXTENSIONS_FILE_OPEN_REQUESTED_CHANNEL,
	type FileOpenRequestedPayload,
} from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';

class OpenedFilesService {
	onOpenRequested(listener: (request: FileOpenRequestedPayload) => void): () => void {
		return onPlatformEvent(EXTENSIONS_FILE_OPEN_REQUESTED_CHANNEL, listener);
	}
}

export const openedFilesService = new OpenedFilesService();
