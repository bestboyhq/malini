import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { queueSendingStore } from '$lib/chat/infrastructure/stores/queue-sending.store.svelte';

export { queueSendingQuery };

class QueueSendingQuery {
	public readonly data: string | null = $derived(queueSendingStore.idFor(chatRoute.workstreamId));
}

const queueSendingQuery = new QueueSendingQuery();
