import type { SessionId } from '$lib/chat/domain/session';
import { closingChatsStore } from '$lib/chat/infrastructure/stores/closing-chats.store.svelte';

export { closingChatsQuery };

class ClosingChatsQuery {
	public readonly data: ReadonlySet<SessionId> = $derived(closingChatsStore.sessionIds);
}

const closingChatsQuery = new ClosingChatsQuery();
