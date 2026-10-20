import type { SessionId } from '$lib/chat/domain/session';

class ClosingChatsStore {
	sessionIds: ReadonlySet<SessionId> = $state.raw(new Set());

	add(sessionId: SessionId): void {
		this.sessionIds = new Set([...this.sessionIds, sessionId]);
	}

	remove(sessionId: SessionId): void {
		if (!this.sessionIds.has(sessionId)) return;
		this.sessionIds = new Set([...this.sessionIds].filter((id) => id !== sessionId));
	}
}

export const closingChatsStore = new ClosingChatsStore();
