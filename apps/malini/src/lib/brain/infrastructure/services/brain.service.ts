import type { BrainDocument, BrainEntry, BrainStatus } from '$contract/brain';
import { BRAIN_CHANGED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class BrainService {
	status(): Promise<BrainStatus> {
		return invoke('brain.status', undefined);
	}

	setUp(sync: boolean): Promise<BrainStatus> {
		return invoke('brain.set-up', { sync });
	}

	setSync(sync: boolean): Promise<BrainStatus> {
		return invoke('brain.set-sync', { sync });
	}

	list(): Promise<BrainEntry[]> {
		return invoke('brain.list', undefined);
	}

	read(path: string): Promise<BrainDocument> {
		return invoke('brain.read', { path });
	}

	onChanged(listener: (status: BrainStatus) => void): () => void {
		return onPlatformEvent(BRAIN_CHANGED_CHANNEL, ({ status }) => listener(status));
	}
}

export const brainService = new BrainService();
