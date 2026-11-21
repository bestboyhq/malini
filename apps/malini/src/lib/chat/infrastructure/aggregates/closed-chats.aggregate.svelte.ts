import type { ClosedChat } from '$lib/chat/domain/closed-chat';
import type { SessionId } from '$lib/chat/domain/session';

class ClosedChatsAggregate {
	byWorkstream: Readonly<Record<string, readonly ClosedChat[]>> = $state.raw({});

	replace(workstreamId: string, chats: readonly ClosedChat[]): void {
		this.byWorkstream = { ...this.byWorkstream, [workstreamId]: chats };
	}

	remove(workstreamId: string, sessionId: SessionId): void {
		const chats = this.byWorkstream[workstreamId];
		if (!chats?.some(({ id }) => id === sessionId)) return;
		this.replace(
			workstreamId,
			chats.filter(({ id }) => id !== sessionId),
		);
	}
}

export const closedChatsAggregate = new ClosedChatsAggregate();
