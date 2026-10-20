import { ROUTINES_CHANGED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';

export function onRoutinesChanged(listener: () => void): () => void {
	return onPlatformEvent(ROUTINES_CHANGED_CHANNEL, () => listener());
}
