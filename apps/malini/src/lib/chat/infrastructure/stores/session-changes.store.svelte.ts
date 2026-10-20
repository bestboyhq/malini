import type { AgentSessionChanges } from '$shared/repositories/repositories.api';

class SessionChangesStore {
	#bySession: ReadonlyMap<string, AgentSessionChanges> = $state.raw(new Map());
	openingPath: string | null = $state(null);
	capturedRevision: number = $state(0);
	openRevision = 0;

	changesFor(sessionId: string | null): AgentSessionChanges | null {
		return sessionId === null ? null : (this.#bySession.get(sessionId) ?? null);
	}

	remember(changes: AgentSessionChanges): void {
		this.#bySession = new Map(this.#bySession).set(changes.sessionId, changes);
	}

	nextOpenRevision(): number {
		return ++this.openRevision;
	}

	noteCapture(): void {
		this.capturedRevision += 1;
	}

	resetTracking(): void {
		this.openingPath = null;
		this.openRevision += 1;
		this.capturedRevision = 0;
	}

	reset(): void {
		this.#bySession = new Map();
		this.resetTracking();
	}
}

export const sessionChangesStore = new SessionChangesStore();
