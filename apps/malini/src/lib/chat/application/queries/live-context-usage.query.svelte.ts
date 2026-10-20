import type { SessionId } from '$lib/chat/domain/session';
import type { LiveContextUsage } from '$lib/chat/domain/streaming-block';
import { streamingStore } from '$lib/chat/infrastructure/stores/streaming.store.svelte';

export { liveContextUsageQuery };

class LiveContextUsageQuery {
	public readonly data: (sessionId: SessionId) => LiveContextUsage | null = $derived(
		(sessionId: SessionId) => streamingStore.liveContextUsageFor(sessionId),
	);
}

const liveContextUsageQuery = new LiveContextUsageQuery();
