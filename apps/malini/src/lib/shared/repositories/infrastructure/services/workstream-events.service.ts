import type {
	CloneProgressPayload,
	WorkstreamFilesChangedPayload,
	WorkstreamInstallStatusPayload,
	WorkstreamRenamedPayload,
	WorktreeAddedPayload,
} from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { WorkstreamMapper } from '$shared/repositories/infrastructure/mappers/workstream.mapper';

class WorkstreamEventsService {
	onWorkstreamsChanged(listener: () => void): () => void {
		const unlisteners = [
			onPlatformEvent('repositories:workstream-created', () => listener()),
			onPlatformEvent('repositories:workstream-removed', () => listener()),
		];
		return () => {
			for (const unlisten of unlisteners) unlisten();
		};
	}

	onWorkstreamCreated(listener: (workstream: Workstream) => void): () => void {
		return onPlatformEvent(
			'repositories:workstream-created',
			(payload: WorktreeAddedPayload | null) => {
				const [workstream] = WorkstreamMapper.fromRawList([payload?.workstream]);
				if (workstream) listener(workstream);
			},
		);
	}

	onFilesChanged(listener: (workstreamId: string) => void): () => void {
		return onPlatformEvent(
			'repositories:workstream-files-changed',
			(payload: WorkstreamFilesChangedPayload | null) => {
				if (!payload || typeof payload !== 'object') return;
				if (typeof payload.workstreamId !== 'string' || payload.workstreamId.length === 0) return;
				listener(payload.workstreamId);
			},
		);
	}

	onInstallStatus(
		workstreamId: string,
		listener: (payload: WorkstreamInstallStatusPayload) => void,
	): () => void {
		return onPlatformEvent(
			'repositories:workstream-install-status',
			(payload: WorkstreamInstallStatusPayload | null) => {
				if (payload?.workstreamId !== workstreamId) return;
				listener(payload);
			},
		);
	}

	onWorkstreamRenamed(listener: (workstreamId: string, name: string) => void): () => void {
		return onPlatformEvent(
			'repositories:workstream-renamed',
			(payload: WorkstreamRenamedPayload | null) => {
				if (!payload || typeof payload.workstreamId !== 'string') return;
				if (typeof payload.name !== 'string') return;
				listener(payload.workstreamId, payload.name);
			},
		);
	}

	onCloneProgress(cloneProgressId: string, listener: (fraction: number) => void): () => void {
		return onPlatformEvent(
			'repositories:clone-progress',
			(payload: CloneProgressPayload | null) => {
				if (payload?.repo_id !== cloneProgressId) return;
				if (typeof payload.fraction !== 'number') return;
				listener(payload.fraction);
			},
		);
	}
}

export const workstreamEventsService = new WorkstreamEventsService();
