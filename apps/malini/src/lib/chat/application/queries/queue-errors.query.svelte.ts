import { queueErrorsStore } from '$lib/chat/infrastructure/stores/queue-errors.store.svelte';

export { queueErrorsQuery };

class QueueErrorsQuery {
	public readonly data: Readonly<Record<string, string>> = $derived(queueErrorsStore.byId);
}

const queueErrorsQuery = new QueueErrorsQuery();
