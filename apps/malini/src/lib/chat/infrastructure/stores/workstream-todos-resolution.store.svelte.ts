import type { WorkstreamTodosResolution } from '$lib/chat/domain/workstream-todos';

class WorkstreamTodosResolutionStore {
	resolution: WorkstreamTodosResolution | null = $state(null);

	get resolving(): boolean {
		return this.resolution?.status === 'resolving';
	}

	settle(resolution: WorkstreamTodosResolution): void {
		if (this.resolution?.requestId !== resolution.requestId) return;
		this.resolution = resolution;
	}

	clear(requestId: string): void {
		if (this.resolution?.requestId !== requestId) return;
		this.resolution = null;
	}

	reset(): void {
		this.resolution = null;
	}
}

export const workstreamTodosResolutionStore = new WorkstreamTodosResolutionStore();
