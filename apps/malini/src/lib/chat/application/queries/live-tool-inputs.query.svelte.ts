import type { RunId } from '$lib/chat/domain/run';
import type { SessionId } from '$lib/chat/domain/session';
import type { LiveToolInput } from '$lib/chat/domain/streaming-block';
import { streamingStore } from '$lib/chat/infrastructure/stores/streaming.store.svelte';

export { liveToolInputsQuery };

class LiveToolInputsQuery {
	public readonly data: (sessionId: SessionId, runId: RunId) => readonly LiveToolInput[] = $derived(
		(sessionId: SessionId, runId: RunId) => streamingStore.toolInputsForRun(sessionId, runId),
	);
}

const liveToolInputsQuery = new LiveToolInputsQuery();
