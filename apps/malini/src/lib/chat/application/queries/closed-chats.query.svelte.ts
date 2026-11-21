import type { ClosedChat } from '$lib/chat/domain/closed-chat';
import { closedChatsAggregate } from '$lib/chat/infrastructure/aggregates/closed-chats.aggregate.svelte';

export { closedChatsQuery };

class ClosedChatsQuery {
	public readonly data: (workstreamId: string) => readonly ClosedChat[] = $derived(
		(workstreamId: string) => closedChatsAggregate.byWorkstream[workstreamId] ?? [],
	);
}

const closedChatsQuery = new ClosedChatsQuery();
