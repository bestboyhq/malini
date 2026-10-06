import type { AgentSessionChanges } from '$shared/repositories/repositories.api';

class SessionChangesStore {
	changes: AgentSessionChanges | null = $state.raw(null);
	openingPath: string | null = $state(null);
	capturedRevision: number = $state(0);
	openRevision = 0;

	nextOpenRevision(): number {
		return ++this.openRevision;
	}

	noteCapture(): void {
		this.capturedRevision += 1;
	}

	reset(): void {
		this.changes = null;
		this.openingPath = null;
		this.openRevision += 1;
		this.capturedRevision = 0;
	}
}

export const sessionChangesStore = new SessionChangesStore();
