import type { SessionId } from '$lib/chat/domain/session';

class TranscriptHistoryAggregate {
	completeSessions: ReadonlySet<SessionId> = $state.raw(new Set());

	setComplete(sessionId: SessionId, complete: boolean): void {
		if (complete === this.completeSessions.has(sessionId)) return;
		const next = new Set(this.completeSessions);
		if (complete) next.add(sessionId);
		else next.delete(sessionId);
		this.completeSessions = next;
	}

	clear(): void {
		if (this.completeSessions.size > 0) this.completeSessions = new Set();
	}
}

export const transcriptHistoryAggregate = new TranscriptHistoryAggregate();
