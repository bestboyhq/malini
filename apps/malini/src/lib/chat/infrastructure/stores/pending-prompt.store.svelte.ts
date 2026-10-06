import type { EventEnvelope } from '$lib/chat/domain/events';
import type { PendingUserPrompt } from '$lib/chat/domain/pending-prompt';
import type { SessionId } from '$lib/chat/domain/session';

class PendingPromptStore {
	private pendingBySession: Readonly<Record<SessionId, PendingUserPrompt>> = $state.raw({});

	for(sessionId: SessionId): PendingUserPrompt | null {
		return this.pendingBySession[sessionId] ?? null;
	}

	set(pending: PendingUserPrompt | null): void {
		if (pending === null) {
			this.pendingBySession = {};
			return;
		}
		this.pendingBySession = { ...this.pendingBySession, [pending.sessionId]: pending };
	}

	clearForSession(sessionId: SessionId): void {
		if (!this.pendingBySession[sessionId]) return;
		const { [sessionId]: _cleared, ...rest } = this.pendingBySession;
		this.pendingBySession = rest;
	}

	clearOnEnvelope(envelope: EventEnvelope): void {
		const pending = this.pendingBySession[envelope.sessionId];
		if (!pending) return;
		if (pending.runId && envelope.runId !== pending.runId) return;
		if (envelope.event.type === 'user.message' || envelope.event.type === 'run.started') {
			this.clearForSession(envelope.sessionId);
		}
	}
}

export const pendingPromptStore = new PendingPromptStore();
