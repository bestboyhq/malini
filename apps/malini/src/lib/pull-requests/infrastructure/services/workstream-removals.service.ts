import type { WorktreeRemovedPayload } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';

class WorkstreamRemovalsService {
	onRemoved(listener: (workstreamId: string) => void): () => void {
		return onPlatformEvent(
			'repositories:workstream-removed',
			(payload: WorktreeRemovedPayload | null) => {
				if (typeof payload?.workstreamId !== 'string' || !payload.workstreamId) return;
				listener(payload.workstreamId);
			},
		);
	}
}

export const workstreamRemovalsService = new WorkstreamRemovalsService();
