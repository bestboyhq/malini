import { APP_STREAMING_CHANGED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class StreamingService {
	current(): Promise<boolean> {
		return invoke('app.streaming', undefined);
	}

	onChange(listener: (streaming: boolean) => void): () => void {
		return onPlatformEvent(APP_STREAMING_CHANGED_CHANNEL, ({ streaming }) => listener(streaming));
	}
}

export const streamingService = new StreamingService();
