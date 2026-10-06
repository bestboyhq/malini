import type { ChatRequestId, ChatRequestOutcome } from '$lib/chat/domain/chat-request';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';

export { chatRequestQuery };

class ChatRequestQuery {
	public readonly data: (requestId: ChatRequestId | null) => ChatRequestOutcome | null = $derived(
		(requestId: ChatRequestId | null) =>
			requestId === null ? null : (chatRequestsStore.outcomes[requestId] ?? null),
	);
}

const chatRequestQuery = new ChatRequestQuery();
