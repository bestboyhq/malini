import type { QueueNote } from '$lib/chat/domain/queued-prompt';
import { queueErrorsStore } from '$lib/chat/infrastructure/stores/queue-errors.store.svelte';

export { queueErrorsQuery };

class QueueErrorsQuery {
	public readonly data: Readonly<Record<string, QueueNote>> = $derived(queueErrorsStore.byId);
}

const queueErrorsQuery = new QueueErrorsQuery();
