import type { WorkstreamFilesChangedPayload } from '$contract/events';
import type { ContextMedia } from '$contract/workstream-images';
import { touchesContextMedia } from '$lib/chat/domain/context-media';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class ContextMediaService {
	list(workstreamId: string): Promise<ContextMedia[]> {
		return invoke('repositories.workstream-context-media', { workstreamId });
	}

	onChanged(workstreamId: string, listener: () => void): () => void {
		return onPlatformEvent(
			'repositories:workstream-files-changed',
			(payload: WorkstreamFilesChangedPayload | null) => {
				if (payload?.workstreamId !== workstreamId) return;
				const paths = Array.isArray(payload.paths) ? payload.paths.filter(isString) : null;
				if (touchesContextMedia(paths)) listener();
			},
		);
	}
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

export const contextMedia = new ContextMediaService();
