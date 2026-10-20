import type { RunId } from '$lib/chat/domain/run';
import type { SessionId } from '$lib/chat/domain/session';
import { streamingStore } from '$lib/chat/infrastructure/stores/streaming.store.svelte';

export { liveToolInputQuery };

class LiveToolInputQuery {
	public readonly data: (sessionId: SessionId, runId: RunId, toolCallId: string) => string | null =
		$derived((sessionId: SessionId, runId: RunId, toolCallId: string) =>
			streamingStore.toolInputJsonFor(sessionId, runId, toolCallId),
		);
}

const liveToolInputQuery = new LiveToolInputQuery();
