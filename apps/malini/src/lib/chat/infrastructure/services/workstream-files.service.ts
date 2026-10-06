import type { WorkstreamFilesChangedPayload } from '$contract/events';
import type { ImageBytes } from '$lib/chat/domain/image-bytes';
import type { WorkstreamFile } from '$lib/chat/domain/workstream-file';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class WorkstreamFilesService {
	list(workstreamId: string): Promise<WorkstreamFile[]> {
		return invoke('repositories.workstream-files', { workstreamId });
	}

	readImage(workstreamId: string, path: string): Promise<ImageBytes | null> {
		return invoke('repositories.read-workstream-image', { workstreamId, path });
	}

	onChanged(workstreamId: string, listener: () => void): () => void {
		return onPlatformEvent(
			'repositories:workstream-files-changed',
			(payload: WorkstreamFilesChangedPayload | null) => {
				if (payload?.workstreamId === workstreamId) listener();
			},
		);
	}
}

export const workstreamFiles = new WorkstreamFilesService();
