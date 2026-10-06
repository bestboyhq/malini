import type { WorkstreamActionKind } from '$shared/repositories/domain/workstream-action';

class WorkstreamActionsStore {
	busy: Readonly<Record<string, WorkstreamActionKind>> = $state.raw({});

	busyFor(workstreamId: string): WorkstreamActionKind | null {
		return this.busy[workstreamId] ?? null;
	}

	begin(workstreamId: string, kind: WorkstreamActionKind): void {
		this.busy = { ...this.busy, [workstreamId]: kind };
	}

	finish(workstreamId: string): void {
		if (!(workstreamId in this.busy)) return;
		const next = { ...this.busy };
		delete next[workstreamId];
		this.busy = next;
	}

	reset(): void {
		this.busy = {};
	}
}

export const workstreamActionsStore = new WorkstreamActionsStore();
